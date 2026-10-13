// Run: node tests/trust.test.mjs   (no dependencies, no Firebase needed)
import assert from 'node:assert/strict';
import { buildClusters, hotspots, label, TYPES } from '../assets/js/trust.js';
import { decodePolyline, pointToPolylineM, distanceM, inBangladesh, nearestArea } from '../assets/js/geo.js';
import { analyse, compareRoutes, RouteError } from '../assets/js/routing.js';
import fs from 'node:fs';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  FAIL', name, '\n      ', e.message); } };
const ta = async (name, fn) => { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  FAIL', name, '\n      ', e.message); } };

const NOW = Date.UTC(2026, 9, 10, 12, 0, 0);
const min = (m) => NOW - m * 60000;
const rep = (id, uid, o = {}) => ({ id, uid, type: 'congestion', level: 'heavy', lat: 23.7579, lng: 90.3893, road: 'Bijoy Sarani', desc: '', locationId: 'farmgate',
  precision: 'pin', createdAt: min(5), expiresAt: min(5) + TYPES.congestion.ttl * 60000, ...o });
const vote = (reportId, uid, v, o = {}) => ({ reportId, uid, vote: v, isNear: true, createdAt: min(2), ...o });
const enc = (pts, p = 6) => { const f = 10 ** p; let out = '', pl = 0, pg = 0;
  for (const [a, b] of pts) { for (const d of [Math.round(a * f) - pl, Math.round(b * f) - pg]) { let v = d < 0 ? ~(d << 1) : d << 1; while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } out += String.fromCharCode(v + 63); } pl = Math.round(a * f); pg = Math.round(b * f); } return out; };

console.log('Geo');
t('polyline decode (Google reference)', () => { const p = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5); assert.equal(p.length, 3); assert.ok(Math.abs(p[0][0] - 38.5) < 1e-9 && Math.abs(p[2][1] + 126.453) < 1e-9); });
t('polyline6 round-trip', () => assert.ok(Math.abs(decodePolyline(enc([[23.7, 90.4], [23.8, 90.4]]))[1][0] - 23.8) < 1e-6));
t('point on / off line', () => { const l = [[23.7, 90.4], [23.8, 90.4]]; assert.ok(pointToPolylineM(23.75, 90.4, l) < 1); const d = pointToPolylineM(23.75, 90.4009, l); assert.ok(d > 85 && d < 115, d); });
t('bounds + distance', () => { assert.ok(inBangladesh(23.8, 90.4) && !inBangladesh(28.6, 77.2)); assert.ok(Math.abs(distanceM(23.7, 90.4, 23.8, 90.4) - 11120) < 80); });
const { locations, roads } = JSON.parse(fs.readFileSync(new URL('../data/locations.json', import.meta.url)));
t('location data', () => { assert.ok(locations.length >= 50 && roads.length >= 30); assert.equal(nearestArea(23.7576, 90.3891, locations).id, 'farmgate'); });

console.log('Trust engine');
t('single report = low confidence', () => { const c = buildClusters([rep('a', 'u1')], [], NOW); assert.equal(c.length, 1); assert.equal(c[0].confidence_label, 'low'); assert.equal(c[0].independent, 1); });
t('independent reports merge and raise confidence', () => {
  const one = buildClusters([rep('a', 'u1')], [], NOW)[0];
  const two = buildClusters([rep('a', 'u1'), rep('b', 'u2', { lat: 23.7585 })], [], NOW)[0];
  const fresh = { createdAt: min(1), expiresAt: min(1) + 90 * 60000 };
  const three = buildClusters([rep('a', 'u1', fresh), rep('b', 'u2', { lat: 23.7585, ...fresh }), rep('c', 'u3', { lng: 90.3899, ...fresh })], [], NOW);
  assert.equal(three.length, 1); assert.equal(three[0].reports, 3);
  assert.ok(two.confidence > one.confidence && three[0].confidence > two.confidence, `${one.confidence} ${two.confidence} ${three[0].confidence}`);
  assert.equal(three[0].confidence_label, 'high');
});
t('same account twice counts once', () => { const c = buildClusters([rep('a', 'u1'), rep('b', 'u1', { lat: 23.7585 })], [], NOW)[0]; assert.equal(c.independent, 1); });
t('confirmation raises, disputes lower confidence', () => {
  const base = buildClusters([rep('a', 'u1'), rep('b', 'u2', { lat: 23.7585 })], [], NOW)[0].confidence;
  const conf = buildClusters([rep('a', 'u1'), rep('b', 'u2', { lat: 23.7585 })], [vote('a', 'u3', 'confirm')], NOW)[0].confidence;
  const dis = buildClusters([rep('a', 'u1'), rep('b', 'u2', { lat: 23.7585 })], [vote('a', 'u4', 'dispute'), vote('a', 'u5', 'dispute')], NOW)[0].confidence;
  assert.ok(conf > base && dis < base, `${base} ${conf} ${dis}`);
});
t('two near disputes outweigh a lone report -> disputed', () => { const c = buildClusters([rep('a', 'u1')], [vote('a', 'u2', 'dispute'), vote('a', 'u3', 'dispute')], NOW)[0]; assert.equal(c.disputed, true); });
t('far-away dispute counts less than a nearby one', () => {
  const near = buildClusters([rep('a', 'u1'), rep('b', 'u2', { lat: 23.7585 })], [vote('a', 'u3', 'dispute')], NOW)[0].confidence;
  const far = buildClusters([rep('a', 'u1'), rep('b', 'u2', { lat: 23.7585 })], [vote('a', 'u3', 'dispute', { isNear: false })], NOW)[0].confidence;
  assert.ok(far > near);
});
t('old reports decay', () => { const fresh = buildClusters([rep('a', 'u1')], [], NOW)[0].confidence; const old = buildClusters([rep('a', 'u1', { createdAt: min(60) })], [], NOW)[0]; assert.ok(!old || old.confidence < fresh); });
t('expired reports disappear', () => assert.equal(buildClusters([rep('a', 'u1', { expiresAt: min(1) })], [], NOW).length, 0));
t('different types / far reports do not merge', () => assert.equal(buildClusters([rep('a', 'u1'), rep('b', 'u2', { type: 'accident' }), rep('c', 'u3', { lat: 23.80 })], [], NOW).length, 3));
t('conflicting severity lowers confidence', () => {
  const same = buildClusters([rep('a', 'u1'), rep('b', 'u2', { lat: 23.7585 })], [], NOW)[0].confidence;
  const mixed = buildClusters([rep('a', 'u1'), rep('b', 'u2', { lat: 23.7585, level: 'clear' })], [], NOW)[0].confidence;
  assert.ok(mixed < same);
});
t('self vote ignored', () => { const a = buildClusters([rep('a', 'u1')], [], NOW)[0].confidence; const b = buildClusters([rep('a', 'u1')], [vote('a', 'u1', 'confirm')], NOW)[0].confidence; assert.equal(a, b); });
t('hotspots: heavy verified area scores heavy; unreported areas omitted', () => {
  const cl = buildClusters([rep('a', 'u1'), rep('b', 'u2', { lat: 23.7585 }), rep('c', 'u3', { lng: 90.3899 })], [vote('a', 'u4', 'confirm')], NOW);
  const h = hotspots(cl, locations);
  assert.equal(h.length, 1); assert.equal(h[0].slug, 'farmgate'); assert.equal(h[0].level, 'heavy');
});
t('labels', () => { assert.equal(label(0.3), 'low'); assert.equal(label(0.5), 'medium'); assert.equal(label(0.8), 'high'); });

console.log('Routing');
const route = [[21.43, 91.98], [21.44, 91.99], [21.45, 91.999]], alt = [[21.43, 91.98], [21.43, 92.0], [21.45, 92.0]];
const inc = { id: 'x', type: 'congestion', level: 'heavy', lat: 21.44, lng: 91.99, confidence: 0.8, confidence_label: 'high', disputed: false, age_min: 5 };
t('incident on route adds heuristic delay + range', () => { const a = analyse(0, decodePolyline(enc(route)), 3000, 600, [inc]); assert.equal(a.incident_count, 1); assert.equal(a.estimate_min, 20); assert.deepEqual(a.range_min, [10, 22]); assert.equal(a.basis, 'crowd_adjusted'); });
t('incident off route ignored -> baseline', () => { const a = analyse(1, decodePolyline(enc(alt)), 4200, 660, [inc]); assert.equal(a.incident_count, 0); assert.equal(a.estimate_min, 11); assert.equal(a.basis, 'baseline'); });
const fake = async () => ({ code: 'Ok', routes: [{ geometry: enc(route), distance: 3000, duration: 600 }, { geometry: enc(alt), distance: 4200, duration: 660 }] });
await ta('compareRoutes recommends the better estimate', async () => {
  const r = await compareRoutes({ lat: 21.43, lng: 91.98 }, { lat: 21.45, lng: 91.999 }, [inc], { osrmUrl: 'http://x', fetcher: fake });
  assert.equal(r.routes.length, 2); assert.equal(r.recommended, 1); assert.equal(r.fastest_free_flow, 0); assert.ok(r.routes[1].recommended);
});
await ta('provider failure -> honest error, no fake time', async () => {
  await assert.rejects(() => compareRoutes({ lat: 21.43, lng: 91.98 }, { lat: 21.45, lng: 91.999 }, [], { osrmUrl: 'http://x', fetcher: async () => { throw new Error('cors'); } }), (e) => e instanceof RouteError && e.code === 'cors');
  await assert.rejects(() => compareRoutes({ lat: 21.43, lng: 91.98 }, { lat: 21.45, lng: 91.999 }, [], { osrmUrl: 'http://x', fetcher: async () => ({ code: 'NoRoute' }) }), (e) => e.code === 'routing_unavailable');
});
await ta('out of Bangladesh / too short rejected', async () => {
  await assert.rejects(() => compareRoutes({ lat: 28.6, lng: 77.2 }, { lat: 23.7, lng: 90.4 }, [], { osrmUrl: 'http://x', fetcher: fake }), (e) => e.code === 'out_of_bounds');
  await assert.rejects(() => compareRoutes({ lat: 23.7, lng: 90.4 }, { lat: 23.7001, lng: 90.4 }, [], { osrmUrl: 'http://x', fetcher: fake }), (e) => e.code === 'route_too_short');
});

console.log('Alternative road (detour) suggestion');
// Straight east-west road through a jam; a fake routing server returns a detour that bends around it.
const A = { lat: 21.4400, lng: 91.9700 }, B = { lat: 21.4400, lng: 91.9900 }, jamMid = { lat: 21.4400, lng: 91.9800 };
const jamInc = { id: 'jam1', type: 'congestion', level: 'heavy', lat: jamMid.lat, lng: jamMid.lng, road_name: 'Main Rd', locationId: null, confidence: 0.8, confidence_label: 'high', disputed: false, age_min: 3 };
const routeServer = async (url) => {
  const m = url.match(/driving\/([^?]+)\?/)[1].split(';').map((c) => c.split(',').map(Number));   // [lng,lat]
  const pts = m.map(([lng, lat]) => [lat, lng]);
  const km = pts.slice(1).reduce((s2, p, i) => s2 + distanceM(pts[i][0], pts[i][1], p[0], p[1]), 0);
  const slow = pts.length === 2;                                       // direct road: 30 km/h free flow, detour: 40 km/h
  return { code: 'Ok', routes: [{ geometry: enc(pts), distance: km, duration: km / ((slow ? 30 : 40) / 3.6) }] };
};
await ta('jam on the only road -> detour suggested, saves time, avoids the jam', async () => {
  const r = await compareRoutes(A, B, [jamInc], { osrmUrl: 'http://x', fetcher: routeServer });
  assert.ok(r.suggestion && r.suggestion.detour_index !== null, JSON.stringify(r.suggestion));
  const d = r.routes[r.suggestion.detour_index];
  assert.equal(d.detour, true); assert.equal(d.incident_count, 0); assert.ok(d.saves_min >= 1);
  assert.equal(r.recommended, r.suggestion.detour_index); assert.equal(d.avoids.id, 'jam1');
  assert.ok(r.routes[r.suggestion.base_index].incident_count === 1);
});
await ta('no jam -> no detour requested', async () => {
  let calls = 0;
  const r = await compareRoutes(A, B, [], { osrmUrl: 'http://x', fetcher: async (u) => { calls++; return routeServer(u); } });
  assert.equal(r.suggestion, null); assert.equal(calls, 1); assert.equal(r.routes.length, 1);
});
await ta('detour that is slower is not suggested (jam stays, honest message)', async () => {
  const slowDetour = async (u) => { const j = await routeServer(u); if ((u.match(/;/g) || []).length === 2) j.routes[0].duration *= 20; return j; };
  const r = await compareRoutes(A, B, [jamInc], { osrmUrl: 'http://x', fetcher: slowDetour });
  assert.ok(r.suggestion && r.suggestion.detour_index === null); assert.equal(r.routes.length, 1);
});
await ta('detour server error -> still returns base route', async () => {
  const flaky = async (u) => { if ((u.match(/;/g) || []).length === 2) throw new Error('boom'); return routeServer(u); };
  const r = await compareRoutes(A, B, [jamInc], { osrmUrl: 'http://x', fetcher: flaky });
  assert.equal(r.routes.length, 1); assert.ok(r.suggestion);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

/*
 * Route comparison (browser). Geometry/distance/free-flow duration come from an OSRM-compatible service
 * (NO live traffic). We add a heuristic delay for community incidents near each route:
 *    estimate = free-flow + sum(typical delay x confidence);  range = [free-flow, free-flow + sum(typical delays)]
 * It is an estimate built from crowd reports, never a measured live travel time.
 */
import { distanceM, inBangladesh, decodePolyline, pointToPolylineM, thin, segmentDirectionAt, offsetPerpendicular } from './geo.js';
import { label, MEDIUM } from './trust.js';

export const DELAY = {
  congestion:   { heavy: 12, moderate: 5,  clear: 0 },
  accident:     { heavy: 15, moderate: 8,  clear: 0 },
  closure:      { heavy: 25, moderate: 15, clear: 0 },
  waterlogging: { heavy: 15, moderate: 6,  clear: 0 },
  roadwork:     { heavy: 10, moderate: 4,  clear: 0 },
};

export class RouteError extends Error { constructor(code, extra = {}) { super(code); this.code = code; this.extra = extra; } }

export function analyse(index, pts, distanceMeters, durationSec, incidents, matchM = 150) {
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for (const p of pts) { minLat = Math.min(minLat, p[0]); maxLat = Math.max(maxLat, p[0]); minLng = Math.min(minLng, p[1]); maxLng = Math.max(maxLng, p[1]); }
  const margin = (matchM * 2) / 111320;
  const matched = [];
  let expected = 0, maxDelay = 0, closure = false;
  for (const c of incidents) {
    if (c.lat < minLat - margin || c.lat > maxLat + margin || c.lng < minLng - margin || c.lng > maxLng + margin) continue;
    const d = pointToPolylineM(c.lat, c.lng, pts);
    if (d > matchM) continue;
    const delay = (DELAY[c.type] && DELAY[c.type][c.level]) || 0;
    expected += delay * c.confidence; maxDelay += delay;
    if (c.type === 'closure' && c.level !== 'clear' && c.confidence >= MEDIUM) closure = true;
    matched.push({ ...c, distance_m: Math.round(d), delay_min: Math.round(delay) });
  }
  matched.sort((a, b) => b.delay_min * b.confidence - a.delay_min * a.confidence);
  const free = durationSec / 60;
  const maxConf = Math.max(0, ...matched.filter((m) => m.delay_min > 0).map((m) => m.confidence));
  const adjusted = maxDelay > 0;
  return {
    index, distance_km: Math.round(distanceMeters / 100) / 10, free_flow_min: Math.round(free),
    estimate_min: Math.round(free + expected), range_min: [Math.round(free), Math.round(free + maxDelay)],
    delay_expected_min: Math.round(expected), basis: adjusted ? 'crowd_adjusted' : 'baseline',
    estimate_confidence: adjusted ? label(maxConf) : 'baseline', closure_warning: closure,
    incident_count: matched.length, incidents: matched.slice(0, 10),
    geometry: thin(pts, 500).map((p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]), recommended: false,
  };
}

const coord = (p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`;
async function getJson(url, fetcher) {
  return fetcher ? fetcher(url) : (await fetch(url, { headers: { Accept: 'application/json' } })).json();
}
const JAM_MIN_SCORE = 4;      // expected delay (minutes x confidence) that makes an incident worth routing around
const DETOUR_OFFSET_M = 700;  // how far beside the jam the detour waypoint is placed

/**
 * Compare routes and, when the best route runs through a jam, suggest an alternative road:
 * we ask the routing server for a route via a waypoint beside the jam (both sides) and keep it only if it
 * avoids the jam and its estimate is lower.
 * @param fetcher injectable for tests: async (url) => parsed JSON
 */
export async function compareRoutes(from, to, incidents, { osrmUrl, matchM = 150, fetcher = null, now = new Date(), detours = true } = {}) {
  if (!inBangladesh(from.lat, from.lng) || !inBangladesh(to.lat, to.lng)) throw new RouteError('out_of_bounds');
  const straight = distanceM(from.lat, from.lng, to.lat, to.lng);
  const straightKm = Math.round(straight / 100) / 10;
  if (straight < 150) throw new RouteError('route_too_short');
  if (straight > 350000) throw new RouteError('route_too_far');
  const base = osrmUrl.replace(/\/$/, '');
  const q = 'overview=full&geometries=polyline6&steps=false';
  let json;
  try { json = await getJson(`${base}/route/v1/driving/${coord(from)};${coord(to)}?alternatives=true&${q}`, fetcher); }
  catch (e) { throw new RouteError('cors', { straight_km: straightKm }); }
  if (!json || json.code !== 'Ok' || !json.routes || !json.routes.length) throw new RouteError('routing_unavailable', { straight_km: straightKm });

  const usable = incidents.filter((c) => !c.disputed && c.confidence >= 0.3);
  const routes = [], geoms = [];
  json.routes.slice(0, 3).forEach((r) => {
    const pts = decodePolyline(r.geometry, 6);
    if (pts.length >= 2) { geoms.push(pts); routes.push(analyse(routes.length, pts, r.distance, r.duration, usable, matchM)); }
  });
  if (!routes.length) throw new RouteError('routing_unavailable', { straight_km: straightKm });

  const pick = () => {
    let best = 0, fastest = 0;
    routes.forEach((r, i) => {
      if (r.estimate_min < routes[best].estimate_min || (r.estimate_min === routes[best].estimate_min && r.distance_km < routes[best].distance_km)) best = i;
      if (r.free_flow_min < routes[fastest].free_flow_min) fastest = i;
    });
    return { best, fastest };
  };
  let { best } = pick();

  // ----- alternative road around the worst jam on the best route -----
  let suggestion = null;
  const jam = detours ? routes[best].incidents.filter((c) => c.confidence >= MEDIUM && c.delay_min * c.confidence >= JAM_MIN_SCORE)[0] : null;
  if (jam) {
    const dir = segmentDirectionAt(jam.lat, jam.lng, geoms[best]);
    const jamInfo = { id: jam.id, type: jam.type, level: jam.level, road_name: jam.road_name || '', locationId: jam.locationId || null, lat: jam.lat, lng: jam.lng, confidence: jam.confidence };
    const cands = [];
    for (const side of [1, -1]) {
      const via = offsetPerpendicular(jam.lat, jam.lng, dir, side * DETOUR_OFFSET_M);
      try {
        const j2 = await getJson(`${base}/route/v1/driving/${coord(from)};${coord(via)};${coord(to)}?alternatives=false&${q}`, fetcher);
        if (j2 && j2.code === 'Ok' && j2.routes && j2.routes[0]) {
          const r = j2.routes[0], pts = decodePolyline(r.geometry, 6);
          if (pts.length >= 2) cands.push({ pts, r2: analyse(routes.length + cands.length, pts, r.distance, r.duration, usable, matchM) });
        }
      } catch (e) { /* detour is optional */ }
    }
    const baseR = routes[best];
    const good = cands.filter((c) => !c.r2.incidents.some((i) => i.id === jam.id) && c.r2.distance_km <= baseR.distance_km * 2.2 + 3 && c.r2.estimate_min <= baseR.estimate_min - 1)
      .sort((a, b) => a.r2.estimate_min - b.r2.estimate_min);
    if (good.length) {
      const d = good[0];
      d.r2.index = routes.length; d.r2.detour = true; d.r2.avoids = jamInfo; d.r2.saves_min = baseR.estimate_min - d.r2.estimate_min;
      routes.push(d.r2); geoms.push(d.pts);
      suggestion = { jam: jamInfo, detour_index: d.r2.index, saves_min: d.r2.saves_min, base_index: best };
    } else {
      suggestion = { jam: jamInfo, detour_index: null, saves_min: 0, base_index: best };
    }
    ({ best } = pick());
  }
  const { fastest } = pick();
  routes.forEach((r, i) => { r.recommended = i === best; });
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Dhaka' }).format(now)) % 24;
  return { ok: true, routes, recommended: best, fastest_free_flow: fastest, suggestion, straight_km: straightKm,
           peak_hour: (hour >= 7 && hour <= 11) || (hour >= 16 && hour <= 21) };
}

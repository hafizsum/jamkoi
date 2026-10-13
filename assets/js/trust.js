/*
 * Community trust engine (browser edition). Same model as the PHP edition, minus IP-based damping
 * (a static site cannot see IPs) - independence is "one Firebase anonymous account counts once".
 *
 *  1. Active reports of the same type within `radius` metres form one incident.
 *  2. Each report / confirmation / dispute is a source weighted by exponential age decay, reputation,
 *     GPS precision and (votes) proximity.
 *  3. confidence = 1 - exp(-K * max(0, support - disputes)), reduced when reports disagree on severity.
 *  4. Independent disputes that outweigh support mark the incident "disputed" (hidden from the map).
 */
import { distanceM, nearestArea } from './geo.js';

export const TYPES = {
  congestion:   { ttl: 90,  half: 30,  boost: 1.0 },
  accident:     { ttl: 150, half: 50,  boost: 1.2 },
  closure:      { ttl: 360, half: 120, boost: 1.3 },
  waterlogging: { ttl: 300, half: 100, boost: 1.1 },
  roadwork:     { ttl: 720, half: 240, boost: 0.8 },
};
export const SEVERITY = { heavy: 1.0, moderate: 0.55, clear: 0.1 };
export const K = 0.55, HIGH = 0.70, MEDIUM = 0.45;

export const decay = (ageMin, half) => Math.pow(0.5, Math.max(0, ageMin) / Math.max(1, half));
export const reputation = (confirmed, disputed) => Math.max(0.3, Math.min(1.15, 0.8 + 0.04 * confirmed - 0.15 * disputed));
export const label = (c) => (c >= HIGH ? 'high' : c >= MEDIUM ? 'medium' : 'low');

/**
 * @param reports [{id, uid, type, level, lat, lng, road, desc, locationId, precision, createdAt(ms), expiresAt(ms)}]
 * @param votes   [{reportId, uid, vote:'confirm'|'dispute', isNear, createdAt(ms)}]
 */
export function buildClusters(reports, votes, now = Date.now(), radius = 250) {
  const live = reports.filter((r) => r.expiresAt > now && TYPES[r.type]).sort((a, b) => a.createdAt - b.createdAt);
  if (!live.length) return [];
  const byId = new Map(reports.map((r) => [r.id, r]));

  // Reputation of each account from the votes its reports received (within the loaded window).
  const stats = new Map();
  const seenVote = new Set();
  for (const v of votes) {
    const rep = byId.get(v.reportId);
    if (!rep || rep.uid === v.uid) continue;
    const k = v.reportId + '_' + v.uid;
    if (seenVote.has(k)) continue;
    seenVote.add(k);
    const s = stats.get(rep.uid) || { c: 0, d: 0 };
    if (v.vote === 'confirm') s.c++; else s.d++;
    stats.set(rep.uid, s);
  }
  const rep = (uid) => { const s = stats.get(uid) || { c: 0, d: 0 }; return reputation(s.c, s.d); };

  const votesBy = new Map();
  for (const v of votes) {
    if (!votesBy.has(v.reportId)) votesBy.set(v.reportId, []);
    votesBy.get(v.reportId).push(v);
  }

  const clusters = [];
  for (const r of live) {
    const c = clusters.find((x) => x.type === r.type && distanceM(x.lat, x.lng, r.lat, r.lng) <= radius);
    if (c) c.members.push(r); else clusters.push({ type: r.type, lat: r.lat, lng: r.lng, members: [r] });
  }
  const out = [];
  for (const c of clusters) {
    const s = score(c, votesBy, rep, now);
    if (s) out.push(s);
  }
  return out.sort((a, b) => b.weight - a.weight);
}

function independentSum(sources) {
  let sum = 0;
  for (const w of sources.values()) sum += w;
  return sum;
}

function score(c, votesBy, rep, now) {
  const half = TYPES[c.type].half;
  const support = new Map(), dispute = new Map();
  const levelW = { heavy: 0, moderate: 0, clear: 0 };
  let best = null, bestW = -1, latest = Infinity, oldest = 0, desc = '', descAge = Infinity, maxTtl = 0;
  let confirms = 0, disputes = 0;
  const ids = [];
  for (const m of c.members) {
    const age = (now - m.createdAt) / 60000;
    const w = decay(age, half) * rep(m.uid) * (m.precision === 'area' ? 0.7 : 1.0);
    if (!support.has(m.uid) || support.get(m.uid) < w) support.set(m.uid, w);
    levelW[m.level] += w;
    if (w > bestW) { bestW = w; best = m; }
    latest = Math.min(latest, age); oldest = Math.max(oldest, age);
    maxTtl = Math.max(maxTtl, (m.expiresAt - now) / 60000);
    ids.push(m.id);
    if (m.desc && age < descAge) { desc = m.desc; descAge = age; }
    for (const v of votesBy.get(m.id) || []) {
      if (v.uid === m.uid) continue;
      const vw = decay((now - v.createdAt) / 60000, half) * rep(v.uid) * (v.isNear ? 1.0 : 0.6);
      if (v.vote === 'confirm') {
        confirms++;
        const cw = vw * 0.7;
        if (!support.has(v.uid) || support.get(v.uid) < cw) support.set(v.uid, cw);
      } else {
        disputes++;
        if (!dispute.has(v.uid) || dispute.get(v.uid) < vw) dispute.set(v.uid, vw);
      }
    }
  }
  const sup = independentSum(support), dis = independentSum(dispute);
  if (sup < 0.12) return null;

  let level = 'clear', mx = -1;
  for (const l of ['heavy', 'moderate', 'clear']) if (levelW[l] > mx + 1e-9) { mx = levelW[l]; level = l; }
  const total = levelW.heavy + levelW.moderate + levelW.clear;
  const minority = total > 0 ? (total - mx) / total : 0;
  let conf = (1 - Math.exp(-K * Math.max(0, sup - dis))) * (1 - 0.4 * minority);
  conf = Math.round(Math.max(0, Math.min(0.99, conf)) * 100) / 100;

  let road = '';
  for (const m of c.members) if (m.road) { road = m.road; if (m.id === best.id) break; }
  return {
    id: best.id, ids, type: c.type, level, lat: best.lat, lng: best.lng,
    locationId: best.locationId || null, road_name: road, description: desc,
    reports: c.members.length, independent: [...support.values()].filter((w) => w >= 0.05).length,
    confirms, disputes, confidence: conf, confidence_label: label(conf),
    disputed: dis >= 1.2 && dis >= sup,
    age_min: Math.round(latest === Infinity ? 0 : latest), first_age_min: Math.round(oldest),
    expires_in_min: Math.max(0, Math.round(maxTtl)), weight: Math.round(conf * sup * 10000) / 10000,
  };
}

/** Per-area hotspot scores 0-100 from live incidents. Areas without live reports are omitted (unknown != clear). */
export function hotspots(clusters, locations) {
  const acc = new Map();
  const byId = new Map(locations.map((l) => [l.id, l]));
  for (const c of clusters) {
    if (c.disputed || c.confidence < 0.25) continue;
    let lid = c.locationId;
    if (!lid || !byId.has(lid)) { const n = nearestArea(c.lat, c.lng, locations); lid = n ? n.id : null; }
    if (!lid) continue;
    const t = TYPES[c.type];
    const x = c.confidence * SEVERITY[c.level] * t.boost * (0.5 + 0.5 * decay(c.age_min, t.half));
    const a = acc.get(lid) || { x: 0, incidents: 0, types: {}, maxConf: 0, minAge: Infinity };
    a.x += x; a.incidents++; a.types[c.type] = (a.types[c.type] || 0) + x;
    a.maxConf = Math.max(a.maxConf, c.confidence); a.minAge = Math.min(a.minAge, c.age_min);
    acc.set(lid, a);
  }
  const rows = [];
  for (const [lid, a] of acc) {
    const loc = byId.get(lid);
    const score = Math.round(100 * (1 - Math.exp(-2.0 * a.x)));
    rows.push({
      location_id: lid, slug: lid, name_bn: loc.name_bn, name_en: loc.name_en, lat: loc.lat, lng: loc.lng,
      score, level: score >= 60 ? 'heavy' : score >= 25 ? 'moderate' : 'clear', incidents: a.incidents,
      top_type: Object.entries(a.types).sort((p, q) => q[1] - p[1])[0][0], confidence: Math.round(a.maxConf * 100) / 100,
      updated_min: a.minAge === Infinity ? 0 : a.minAge,
    });
  }
  return rows.sort((p, q) => q.score - p.score);
}

export function overview(clusters, reports24h = 0) {
  const ok = clusters.filter((c) => !c.disputed);
  const avg = ok.length ? ok.reduce((s, c) => s + c.confidence, 0) / ok.length : 0;
  return {
    active_incidents: ok.length,
    verified_incidents: ok.filter((c) => c.confidence >= HIGH).length,
    heavy_incidents: ok.filter((c) => c.level === 'heavy' && c.confidence >= MEDIUM).length,
    reports_24h: reports24h, avg_confidence: Math.round(avg * 100) / 100,
  };
}

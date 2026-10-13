/* Pure geo helpers (no DOM, no Firebase) so they can be unit-tested in Node. */
export const BD = { minLat: 20.5, maxLat: 26.75, minLng: 88.0, maxLng: 92.75 };

export const inBangladesh = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && lat >= BD.minLat && lat <= BD.maxLat && lng >= BD.minLng && lng <= BD.maxLng;

export function distanceM(lat1, lng1, lat2, lng2) {
  const r = 6371000, rad = Math.PI / 180;
  const p1 = lat1 * rad, p2 = lat2 * rad, dp = p2 - p1, dl = (lng2 - lng1) * rad;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Decode an encoded polyline (OSRM polyline6 by default) into [[lat,lng],...]. */
export function decodePolyline(str, precision = 6) {
  let index = 0, lat = 0, lng = 0;
  const out = [], f = 10 ** precision;
  while (index < str.length) {
    for (let axis = 0; axis < 2; axis++) {
      let shift = 0, result = 0, b;
      do {
        if (index >= str.length) return out;
        b = str.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const d = (result & 1) ? ~(result >> 1) : (result >> 1);
      if (axis === 0) lat += d; else lng += d;
    }
    out.push([lat / f, lng / f]);
  }
  return out;
}

/** Minimum distance in metres from a point to a polyline (flat-earth approximation). */
export function pointToPolylineM(lat, lng, pts) {
  const n = pts.length;
  if (!n) return Infinity;
  const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540;
  let ax = (pts[0][1] - lng) * kx, ay = (pts[0][0] - lat) * ky;
  if (n === 1) return Math.hypot(ax, ay);
  let best = Infinity;
  for (let i = 1; i < n; i++) {
    const bx = (pts[i][1] - lng) * kx, by = (pts[i][0] - lat) * ky;
    const dx = bx - ax, dy = by - ay, den = dx * dx + dy * dy;
    const t = den > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / den)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) best = d;
    ax = bx; ay = by;
  }
  return best;
}

export function thin(pts, max = 500) {
  if (pts.length <= max) return pts;
  const step = Math.ceil(pts.length / max), out = [];
  for (let i = 0; i < pts.length; i += step) out.push(pts[i]);
  if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out;
}

/** Nearest *area* (not district) whose radius contains the point, else nearest within maxM. */
export function nearestArea(lat, lng, locations, maxM = 6000) {
  let best = null, bd = Infinity;
  for (const l of locations) {
    if (l.kind !== 'area') continue;
    const d = distanceM(lat, lng, l.lat, l.lng);
    if (d <= Math.max(l.radius, 1000) && d < bd) { best = l; bd = d; }
  }
  if (best) return best;
  for (const l of locations) {
    if (l.kind !== 'area') continue;
    const d = distanceM(lat, lng, l.lat, l.lng);
    if (d <= maxM && d < bd) { best = l; bd = d; }
  }
  return best;
}

/** Direction (metres east/north) of the polyline segment nearest to a point. */
export function segmentDirectionAt(lat, lng, pts) {
  const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540;
  let best = Infinity, dir = { dx: 1, dy: 0 };
  for (let i = 1; i < pts.length; i++) {
    const ax = (pts[i - 1][1] - lng) * kx, ay = (pts[i - 1][0] - lat) * ky, bx = (pts[i][1] - lng) * kx, by = (pts[i][0] - lat) * ky;
    const dx = bx - ax, dy = by - ay, den = dx * dx + dy * dy, t = den > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / den)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) { best = d; dir = { dx, dy }; }
  }
  return dir;
}

/** Point `meters` away from (lat,lng), perpendicular to direction {dx,dy}; positive side = left of travel. */
export function offsetPerpendicular(lat, lng, dir, meters) {
  const len = Math.hypot(dir.dx, dir.dy) || 1;
  const px = -dir.dy / len, py = dir.dx / len;
  return { lat: lat + (py * meters) / 110540, lng: lng + (px * meters) / (111320 * Math.cos(lat * Math.PI / 180)) };
}

/* Live data: Firestore listeners -> trust engine -> callbacks. Falls back to demo data when unconfigured. */
import { isConfigured, db, collection, query, where, orderBy, limit, onSnapshot, Timestamp, getCountFromServer } from './fb.js';
import { buildClusters, hotspots, overview } from './trust.js';
import { APP, loadLocations, LOCATIONS } from './core.js';
import { demoData } from './demo.js';

const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : (typeof t === 'number' ? t : Date.now()));

function parseReport(d) {
  const x = d.data();
  return { id: d.id, uid: x.uid, type: x.type, level: x.level, lat: x.lat, lng: x.lng, road: x.road || '', desc: x.desc || '',
    locationId: x.locationId || null, precision: x.precision || 'pin', createdAt: ms(x.createdAt), expiresAt: ms(x.expiresAt) };
}
const parseVote = (d) => { const x = d.data(); return { reportId: x.reportId, uid: x.uid, vote: x.vote, isNear: !!x.isNear, createdAt: ms(x.createdAt) }; };

/**
 * cb({clusters, hotspots, reports, votes, demo, error}) is called on every change and every 30 s (aging).
 * Cost model: one initial read per live document, then only changed documents (realtime listener + local cache).
 * @returns unsubscribe function
 */
export function subscribeLive(cb) {
  let reports = [], votes = [], demo = false, error = null;
  const emit = () => {
    const now = Date.now();
    const clusters = buildClusters(reports, votes, now);
    cb({ clusters, hotspots: hotspots(clusters, LOCATIONS), reports, votes, demo, error });
  };
  const timer = setInterval(emit, 30000);
  const offs = [];

  loadLocations().then(() => {
    if (!isConfigured) { ({ reports, votes } = demoData()); demo = true; emit(); return; }
    const since = Timestamp.fromMillis(Date.now() - APP.liveWindowHours * 3600e3);
    offs.push(onSnapshot(query(collection(db, 'reports'), where('createdAt', '>=', since), orderBy('createdAt', 'desc'), limit(600)),
      (snap) => { reports = snap.docs.map(parseReport); error = null; emit(); },
      (e) => { console.error(e); error = e; emit(); }));
    offs.push(onSnapshot(query(collection(db, 'votes'), where('createdAt', '>=', since), orderBy('createdAt', 'desc'), limit(1200)),
      (snap) => { votes = snap.docs.map(parseVote); emit(); }, (e) => console.error(e)));
  });
  return () => { clearInterval(timer); offs.forEach((o) => o()); };
}

/** Cached aggregate count (1 read) - used for "reports in 24h" style stats. */
export async function cachedCount(key, buildQuery, ttlMs = 5 * 60000) {
  if (!isConfigured) return 0;
  const k = 'jk_cnt_' + key;
  try { const c = JSON.parse(sessionStorage.getItem(k) || 'null'); if (c && Date.now() - c.t < ttlMs) return c.v; } catch (e) { /* ignore */ }
  const v = (await getCountFromServer(buildQuery())).data().count;
  try { sessionStorage.setItem(k, JSON.stringify({ t: Date.now(), v })); } catch (e) { /* ignore */ }
  return v;
}

export { overview };

export const reportsLast24h = () => cachedCount('r24', () => query(collection(db, 'reports'), where('createdAt', '>=', Timestamp.fromMillis(Date.now() - 864e5))));
export const votesLast24h = () => cachedCount('v24', () => query(collection(db, 'votes'), where('createdAt', '>=', Timestamp.fromMillis(Date.now() - 864e5))));

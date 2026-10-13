/* Write operations: anonymous reports and votes. Firestore rules are the real gatekeeper; these checks are for UX. */
import { db, isConfigured, ensureUser, doc, collection, getDoc, setDoc, writeBatch, serverTimestamp, Timestamp } from './fb.js';
import { TYPES as TTL } from './trust.js';
import { inBangladesh, distanceM, nearestArea } from './geo.js';
import { tr, LOCATIONS, LOC_BY_ID, rememberVote, toast, getPosition } from './core.js';

export class ActionError extends Error { constructor(code, message, extra = {}) { super(message); this.code = code; this.extra = extra; } }

function mapError(e) {
  if (e instanceof ActionError) return e;
  const c = (e && e.code) || '';
  if (c === 'permission-denied') return new ActionError('permission', tr('err.permission'));
  if (c === 'unavailable' || c === 'deadline-exceeded') return new ActionError('network', tr('err.network'));
  if (e && e.message === 'demo') return new ActionError('demo', tr('err.demo_mode'));
  console.error(e);
  return new ActionError('server_error', tr('err.server_error'));
}

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);
const bnDigits = (s) => s.replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d));

/** @param f {type, level, locationId, road, description, lat, lng, precision} @param live current live reports (duplicate check) */
export async function submitReport(f, live = []) {
  try {
    if (!isConfigured) throw new ActionError('demo', tr('err.demo_mode'));
    if (!TTL[f.type]) throw new ActionError('invalid_type', tr('err.invalid_type'));
    if (!['heavy', 'moderate', 'clear'].includes(f.level)) throw new ActionError('invalid_level', tr('err.invalid_level'));
    const loc = f.locationId ? LOC_BY_ID.get(f.locationId) : null;
    let { lat, lng, precision } = f;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      if (!loc) throw new ActionError('location_required', tr('err.location_required'));
      lat = loc.lat; lng = loc.lng; precision = 'area';
    }
    if (!inBangladesh(lat, lng)) throw new ActionError('out_of_bounds', tr('err.out_of_bounds'));
    lat = Math.round(lat * 1e6) / 1e6; lng = Math.round(lng * 1e6) / 1e6;
    const area = loc || nearestArea(lat, lng, LOCATIONS);
    const road = clean(f.road, 120), desc = clean(f.description, 300);
    const text = bnDigits(desc + ' ' + road).toLowerCase();
    if (/(https?:\/\/|www\.|\.com|\.net|\.org)/.test(text) || /01[3-9][0-9]{8}/.test(text.replace(/[\s-]/g, ''))) throw new ActionError('link', tr('err.link_in_text'));

    const user = await ensureUser();
    const now = Date.now();
    const dup = live.find((r) => r.uid === user.uid && r.type === f.type && now - r.createdAt < 15 * 60000 && distanceM(lat, lng, r.lat, r.lng) <= 150);
    if (dup) throw new ActionError('duplicate', tr('err.duplicate'), { id: dup.id });

    // Per-account throttle: rules require this users/{uid} write in the same batch (45 s gap, 6 reports/hour).
    const uref = doc(db, 'users', user.uid);
    let snap = null;
    try { snap = await getDoc(uref); } catch (e) { /* first report */ }
    const st = serverTimestamp();
    let u = { lastReportAt: st, hourStart: st, hourCount: 1 };
    if (snap && snap.exists()) {
      const d = snap.data();
      if (now < d.hourStart.toMillis() + 3600e3) u = { lastReportAt: st, hourStart: d.hourStart, hourCount: d.hourCount + 1 };
    }
    const rref = doc(collection(db, 'reports'));
    const report = {
      type: f.type, level: f.level, lat, lng, precision: precision === 'gps' ? 'gps' : precision === 'area' ? 'area' : 'pin',
      road, desc, uid: user.uid, createdAt: st,
      expiresAt: Timestamp.fromMillis(now + TTL[f.type].ttl * 60000), utcHour: new Date(now).getUTCHours(),
    };
    if (area) report.locationId = area.id;
    const batch = writeBatch(db);
    batch.set(uref, u);
    batch.set(rref, report);
    await batch.commit();
    return { id: rref.id };
  } catch (e) { throw mapError(e); }
}

export async function castVote(reportId, vote, pos, live = []) {
  try {
    if (!isConfigured) throw new ActionError('demo', tr('err.demo_mode'));
    if (!['confirm', 'dispute'].includes(vote)) throw new ActionError('invalid_vote', tr('err.invalid_vote'));
    const user = await ensureUser();
    const r = live.find((x) => x.id === reportId);
    if (r && r.uid === user.uid) throw new ActionError('own_report', tr('err.own_report'));
    const isNear = !!(pos && r && distanceM(pos.lat, pos.lng, r.lat, r.lng) <= 1500);
    await setDoc(doc(db, 'votes', `${reportId}_${user.uid}`), { reportId, uid: user.uid, vote, isNear, createdAt: serverTimestamp() });
    rememberVote(reportId, vote);
    return { ok: true };
  } catch (e) { throw mapError(e); }
}

/** Delegated click handler for any [data-vote] button (popups, report page). */
export function bindVoting(getLive) {
  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-vote]');
    if (!b || b.disabled) return;
    b.disabled = true;
    try {
      const pos = await getPosition(3500);
      await castVote(b.dataset.id, b.dataset.vote, pos, getLive());
      toast(tr('js.vote_thanks'), 'success');
    } catch (e) { toast(e.message, 'danger'); } finally { b.disabled = false; }
  });
}

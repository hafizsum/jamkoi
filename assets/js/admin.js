/* Admin panel (English). Everything is enforced by Firestore rules: only users listed in admins/{uid} can write. */
import {
  isConfigured, auth, db, signInWithEmailAndPassword, signOut, onAuthStateChanged, collection, doc, query, where, orderBy, limit,
  getDocs, getDoc, setDoc, addDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, Timestamp, getCountFromServer,
} from './fb.js';
import { STRINGS } from './strings.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const flash = (m, t = 'success') => { $('#msg').innerHTML = `<div class="alert alert-${t} py-2 alert-dismissible">${esc(m)}<button class="btn-close" data-bs-dismiss="alert"></button></div>`; };
const fmt = (ts) => (ts && ts.toDate ? ts.toDate().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–');
const toTs = (v) => (v ? Timestamp.fromDate(new Date(v)) : null);   // datetime-local is interpreted in the browser's timezone
const csv = (rows) => rows.map((r) => r.map((c) => { let s = String(c ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; }).join(',')).join('\n');
const download = (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); };
const locs = (await (await fetch('../data/locations.json')).json()).locations;
const areas = locs.filter((l) => l.kind === 'area');

const SLOTS = [['home_top', 'Home – top banner'], ['home_side', 'Home – side panel'], ['report_page', 'Report page'], ['dashboard', 'Dashboard'], ['route_page', 'Routes page'], ['area_page', 'Area pages']];
const TABS = { reports: 'Reports', blocked: 'Blocked users', ads: 'Ads', sponsors: 'Sponsored', subs: 'Alert waitlist', settings: 'Settings', tools: 'Analytics & clean-up' };
let current = 'reports';

if (!isConfigured) { $('#msg').innerHTML = '<div class="alert alert-warning">Firebase is not configured. Open <a href="../setup.html">setup.html</a> first.</div>'; }
else {
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await signInWithEmailAndPassword(auth, $('#em').value, $('#pw').value); } catch (err) { flash('Login failed: ' + err.code, 'danger'); }
  });
  $('#logout').addEventListener('click', () => signOut(auth));
  onAuthStateChanged(auth, async (u) => {
    const real = u && !u.isAnonymous;
    $('#login').classList.toggle('d-none', !!real);
    $('#panel').classList.add('d-none'); $('#logout').classList.toggle('d-none', !real); $('#who').textContent = real ? u.email : '';
    if (!real) { if (u) signOut(auth); return; }
    let ok = false;
    try { ok = (await getDoc(doc(db, 'admins', u.uid))).exists(); } catch (e) { /* not an admin */ }
    if (!ok) { flash('This account is not an admin (no admins/' + u.uid + ' document).', 'danger'); return; }
    $('#panel').classList.remove('d-none');
    renderTabs(); show(current);
  });
}

function renderTabs() {
  $('#tabs').innerHTML = Object.entries(TABS).map(([k, l]) => `<li class="nav-item"><a class="nav-link ${k === current ? 'active' : ''}" href="#" data-tab="${k}">${l}</a></li>`).join('');
}
document.addEventListener('click', (e) => { const t = e.target.closest('[data-tab]'); if (t) { e.preventDefault(); current = t.dataset.tab; renderTabs(); show(current); } });
const show = (k) => ({ reports, blocked, ads, sponsors, subs, settings, tools }[k]());
const view = $('#view');
const busy = () => { view.innerHTML = '<p class="text-muted">Loading…</p>'; };

/* ---------------- reports ---------------- */
async function reports() {
  busy();
  const snap = await getDocs(query(collection(db, 'reports'), orderBy('createdAt', 'desc'), limit(100)));
  const blockedIds = new Set((await getDocs(collection(db, 'blocked'))).docs.map((d) => d.id));
  view.innerHTML = `<p class="text-muted small">Latest 100 reports. Delete abusive ones; block an anonymous user id to stop all their future reports and votes. Nothing needs approval.</p>
  <div class="table-responsive"><table class="table table-sm table-hover bg-white align-middle"><thead><tr><th>When</th><th>Type / level</th><th>Where</th><th>Text</th><th>User</th><th></th></tr></thead><tbody>` +
    snap.docs.map((d) => { const x = d.data(); return `<tr><td class="small">${fmt(x.createdAt)}</td><td>${esc(x.type)} / ${esc(x.level)}</td><td class="small">${esc(x.road)}<br><span class="text-muted">${esc(x.locationId || '')} (${esc(x.precision)})</span></td>
      <td class="small" style="max-width:260px">${esc((x.desc || '').slice(0, 140))}</td><td class="small">${esc(x.uid.slice(0, 8))}${blockedIds.has(x.uid) ? ' <span class="badge text-bg-danger">blocked</span>' : ''}</td>
      <td class="text-nowrap"><button class="btn btn-sm btn-outline-danger" data-del="${d.id}">Delete</button> <button class="btn btn-sm btn-danger" data-block="${esc(x.uid)}">Block user</button></td></tr>`; }).join('') +
    '</tbody></table></div>';
}
document.addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del]'), blk = e.target.closest('[data-block]');
  try {
    if (del && confirm('Delete this report?')) { await deleteDoc(doc(db, 'reports', del.dataset.del)); flash('Report deleted.'); reports(); }
    if (blk && confirm('Block this anonymous user?')) { await setDoc(doc(db, 'blocked', blk.dataset.block), { createdAt: serverTimestamp() }); flash('User blocked.'); reports(); }
    const unb = e.target.closest('[data-unblock]');
    if (unb) { await deleteDoc(doc(db, 'blocked', unb.dataset.unblock)); flash('Unblocked.'); blocked(); }
  } catch (err) { flash(err.code || err.message, 'danger'); }
});

async function blocked() {
  busy();
  const snap = await getDocs(collection(db, 'blocked'));
  view.innerHTML = '<ul class="list-group">' + (snap.docs.map((d) => `<li class="list-group-item d-flex justify-content-between"><code>${esc(d.id)}</code><span>${fmt(d.data().createdAt)} <button class="btn btn-sm btn-outline-secondary ms-2" data-unblock="${esc(d.id)}">Unblock</button></span></li>`).join('') || '<li class="list-group-item text-muted">No blocked users.</li>') + '</ul>';
}

/* ---------------- ads + sponsors ---------------- */
const areaOpts = '<option value="">All areas</option>' + areas.map((a) => `<option value="${a.id}">${esc(a.name_en)}</option>`).join('');
const urlOk = (u, https = false) => (https ? /^https:\/\//i : /^https?:\/\//i).test(u);
async function ads() {
  busy();
  const snap = await getDocs(collection(db, 'ads'));
  view.innerHTML = `<p class="text-muted small">Placements: home_top, home_side, report_page, dashboard, route_page, area_page. Ads are always labelled "Sponsored". Click counts only (no impression counting on a static site).</p>
  <div class="table-responsive"><table class="table table-sm bg-white align-middle"><thead><tr><th>Placement</th><th>Title</th><th>Area</th><th>Runs</th><th>Clicks</th><th></th></tr></thead><tbody>` +
    snap.docs.map((d) => { const a = d.data(); return `<tr class="${a.isActive ? '' : 'table-secondary'}"><td>${esc(a.placement)}</td><td>${esc(a.title)}<br><a class="small" href="${esc(a.linkUrl)}" target="_blank" rel="noopener noreferrer">${esc((a.linkUrl || '').slice(0, 40))}</a></td><td>${esc(a.locationId || 'all')}</td><td class="small">${fmt(a.startsAt)} → ${a.endsAt ? fmt(a.endsAt) : '∞'}</td><td>${a.clicks || 0}</td>
      <td class="text-nowrap"><button class="btn btn-sm btn-outline-secondary" data-col="ads" data-toggle="${d.id}" data-on="${a.isActive ? 1 : 0}">${a.isActive ? 'Disable' : 'Enable'}</button> <button class="btn btn-sm btn-outline-danger" data-col="ads" data-remove="${d.id}">Delete</button></td></tr>`; }).join('') +
    `</tbody></table></div><div class="card"><div class="card-header">New ad</div><div class="card-body"><form id="ad-form" class="row g-2">
    <div class="col-md-3"><label class="form-label small">Placement</label><select name="placement" class="form-select form-select-sm">${['home_top', 'home_side', 'report_page', 'dashboard', 'route_page', 'area_page'].map((p) => `<option>${p}</option>`).join('')}</select></div>
    <div class="col-md-5"><label class="form-label small">Title</label><input name="title" class="form-control form-control-sm" required maxlength="120"></div>
    <div class="col-md-4"><label class="form-label small">Advertiser</label><input name="advertiser" class="form-control form-control-sm" maxlength="120"></div>
    <div class="col-12"><label class="form-label small">Text</label><input name="body" class="form-control form-control-sm" maxlength="255"></div>
    <div class="col-md-6"><label class="form-label small">Link (http/https)</label><input name="linkUrl" class="form-control form-control-sm" required></div>
    <div class="col-md-6"><label class="form-label small">Image (https, optional)</label><input name="imageUrl" class="form-control form-control-sm"></div>
    <div class="col-md-4"><label class="form-label small">Area</label><select name="locationId" class="form-select form-select-sm">${areaOpts}</select></div>
    <div class="col-md-4"><label class="form-label small">Starts</label><input type="datetime-local" name="startsAt" class="form-control form-control-sm"></div>
    <div class="col-md-4"><label class="form-label small">Ends</label><input type="datetime-local" name="endsAt" class="form-control form-control-sm"></div>
    <div class="col-12"><button class="btn btn-dark btn-sm">Create ad</button></div></form></div></div>`;
  $('#ad-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (!urlOk(f.linkUrl) || (f.imageUrl && !urlOk(f.imageUrl, true))) return flash('Link must be http(s) and image must be https.', 'danger');
    const data = { placement: f.placement, title: f.title, body: f.body || '', linkUrl: f.linkUrl, imageUrl: f.imageUrl || '', advertiser: f.advertiser || '', isActive: true, clicks: 0, startsAt: toTs(f.startsAt), endsAt: toTs(f.endsAt), createdAt: serverTimestamp() };
    if (f.locationId) data.locationId = f.locationId;
    try { await addDoc(collection(db, 'ads'), data); sessionStorage.removeItem('jk_ads'); flash('Ad created.'); ads(); } catch (err) { flash(err.code, 'danger'); }
  });
}
async function sponsors() {
  busy();
  const snap = await getDocs(collection(db, 'sponsors'));
  view.innerHTML = `<div class="table-responsive"><table class="table table-sm bg-white align-middle"><thead><tr><th>Name</th><th>Category</th><th>Tier</th><th>Lat, Lng</th><th></th></tr></thead><tbody>` +
    snap.docs.map((d) => { const s = d.data(); return `<tr class="${s.isActive ? '' : 'table-secondary'}"><td>${esc(s.name_en)} <span class="text-muted small">${esc(s.name_bn)}</span></td><td>${esc(s.category)}</td><td>${esc(s.tier)}</td><td class="small">${s.lat}, ${s.lng}</td>
      <td class="text-nowrap"><button class="btn btn-sm btn-outline-secondary" data-col="sponsors" data-toggle="${d.id}" data-on="${s.isActive ? 1 : 0}">${s.isActive ? 'Disable' : 'Enable'}</button> <button class="btn btn-sm btn-outline-danger" data-col="sponsors" data-remove="${d.id}">Delete</button></td></tr>`; }).join('') +
    `</tbody></table></div><div class="card"><div class="card-header">New sponsored listing</div><div class="card-body"><form id="sp-form" class="row g-2">
    <div class="col-md-4"><label class="form-label small">Name (English)</label><input name="name_en" class="form-control form-control-sm" maxlength="120"></div>
    <div class="col-md-4"><label class="form-label small">Name (Bangla)</label><input name="name_bn" class="form-control form-control-sm" maxlength="120"></div>
    <div class="col-md-2"><label class="form-label small">Category</label><select name="category" class="form-select form-select-sm">${['fuel', 'parking', 'towing', 'repair', 'food', 'other'].map((c) => `<option>${c}</option>`).join('')}</select></div>
    <div class="col-md-2"><label class="form-label small">Tier</label><select name="tier" class="form-select form-select-sm"><option>basic</option><option>featured</option></select></div>
    <div class="col-md-6"><label class="form-label small">Description</label><input name="description" class="form-control form-control-sm" maxlength="255"></div>
    <div class="col-md-3"><label class="form-label small">Phone</label><input name="phone" class="form-control form-control-sm" maxlength="30"></div>
    <div class="col-md-3"><label class="form-label small">Link</label><input name="linkUrl" class="form-control form-control-sm"></div>
    <div class="col-md-3"><label class="form-label small">Latitude</label><input name="lat" class="form-control form-control-sm" required></div>
    <div class="col-md-3"><label class="form-label small">Longitude</label><input name="lng" class="form-control form-control-sm" required></div>
    <div class="col-12"><button class="btn btn-dark btn-sm">Create listing</button></div></form></div></div>`;
  $('#sp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)), lat = parseFloat(f.lat), lng = parseFloat(f.lng);
    if (!(lat >= 20.5 && lat <= 26.75 && lng >= 88 && lng <= 92.75)) return flash('Coordinates must be inside Bangladesh.', 'danger');
    if (f.linkUrl && !urlOk(f.linkUrl)) return flash('Link must be http(s).', 'danger');
    try { await addDoc(collection(db, 'sponsors'), { name_en: f.name_en || f.name_bn, name_bn: f.name_bn || f.name_en, category: f.category, tier: f.tier, description: f.description || '', phone: f.phone || '', linkUrl: f.linkUrl || '', lat, lng, isActive: true, createdAt: serverTimestamp() }); sessionStorage.removeItem('jk_sponsors'); flash('Listing created.'); sponsors(); } catch (err) { flash(err.code, 'danger'); }
  });
}
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-toggle]'), r = e.target.closest('[data-remove]');
  try {
    if (t) { await updateDoc(doc(db, t.dataset.col, t.dataset.toggle), { isActive: t.dataset.on !== '1' }); sessionStorage.removeItem(t.dataset.col === 'ads' ? 'jk_ads' : 'jk_sponsors'); show(current); }
    if (r && confirm('Delete permanently?')) { await deleteDoc(doc(db, r.dataset.col, r.dataset.remove)); sessionStorage.removeItem(r.dataset.col === 'ads' ? 'jk_ads' : 'jk_sponsors'); show(current); }
  } catch (err) { flash(err.code || err.message, 'danger'); }
});

/* ---------------- waitlist ---------------- */
async function subs() {
  busy();
  const snap = await getDocs(collection(db, 'subscriptions'));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  view.innerHTML = `<p class="text-muted small">People who asked to be contacted about premium alerts (they gave consent). Sending alerts needs an email/SMS provider - see README.</p><button class="btn btn-sm btn-outline-dark mb-2" id="exp">Export CSV</button>
  <div class="table-responsive"><table class="table table-sm bg-white"><thead><tr><th>Channel</th><th>Contact</th><th>Area</th><th>Min level</th><th>Joined</th></tr></thead><tbody>` +
    rows.map((r) => `<tr><td>${esc(r.channel)}</td><td>${esc(r.contact)}</td><td>${esc(r.locationId || 'all')}</td><td>${esc(r.minLevel)}</td><td class="small">${fmt(r.createdAt)}</td></tr>`).join('') + '</tbody></table></div>';
  $('#exp').onclick = () => download('jamkoi-alert-waitlist.csv', csv([['channel', 'contact', 'area', 'min_level', 'joined'], ...rows.map((r) => [r.channel, r.contact, r.locationId || '', r.minLevel, fmt(r.createdAt)])]));
}

/* ---------------- settings ---------------- */
async function settings() {
  busy();
  const s = { adsEnabled: true, sponsoredEnabled: true, showPlaceholders: true, announcement_bn: '', announcement_en: '', ...((await getDoc(doc(db, 'settings', 'public'))).data() || {}) };
  view.innerHTML = `<form id="set-form" class="card"><div class="card-body row g-3">
    <div class="col-md-6"><label class="form-label">Announcement (Bangla)</label><textarea name="announcement_bn" class="form-control" rows="2" maxlength="300">${esc(s.announcement_bn)}</textarea></div>
    <div class="col-md-6"><label class="form-label">Announcement (English)</label><textarea name="announcement_en" class="form-control" rows="2" maxlength="300">${esc(s.announcement_en)}</textarea></div>
    ${[['adsEnabled', 'Show ads'], ['sponsoredEnabled', 'Show sponsored map listings'], ['showPlaceholders', 'Show "Advertise here" in empty slots']].map(([k, l]) => `<div class="col-md-4"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="${k}" ${s[k] ? 'checked' : ''}><label class="form-check-label">${l}</label></div></div>`).join('')}
    <div class="col-12"><hr class="my-1"><div class="small fw-semibold mb-1">Ad spots (untick to hide a spot everywhere)</div><div class="row">${SLOTS.map(([k, l]) => `<div class="col-md-4"><div class="form-check"><input class="form-check-input" type="checkbox" name="slot_${k}" ${(s.slots || {})[k] === false ? '' : 'checked'}><label class="form-check-label small">${l} <code>${k}</code></label></div></div>`).join('')}</div></div>
    <div class="col-12"><button class="btn btn-dark">Save</button> <span class="small text-muted ms-2">Visitors see changes within ~10 minutes (cached).</span></div></div></form>`;
  $('#set-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await setDoc(doc(db, 'settings', 'public'), { announcement_bn: String(f.get('announcement_bn')), announcement_en: String(f.get('announcement_en')), adsEnabled: f.has('adsEnabled'), sponsoredEnabled: f.has('sponsoredEnabled'), showPlaceholders: f.has('showPlaceholders'), slots: Object.fromEntries(SLOTS.map(([k]) => [k, f.has('slot_' + k)])) });
      sessionStorage.removeItem('jk_settings'); flash('Settings saved.');
    } catch (err) { flash(err.code, 'danger'); }
  });
}

/* ---------------- analytics + clean-up ---------------- */
async function tools() {
  view.innerHTML = `<div class="row g-3"><div class="col-lg-7"><div class="card"><div class="card-header">Area analytics (last 30 days)</div><div class="card-body">
    <p class="small text-muted">Uses Firestore count() queries: about ${areas.length * 2} reads per run. Run on demand.</p><button class="btn btn-dark btn-sm" id="run-an">Run analytics</button> <button class="btn btn-outline-success btn-sm d-none" id="exp-an">Export CSV</button>
    <div id="an-out" class="mt-3"></div></div></div></div>
  <div class="col-lg-5"><div class="card"><div class="card-header">Clean-up</div><div class="card-body">
    <p class="small text-muted">A static site has no cron job. Delete old reports and votes here now and then (keeps the database small and history queries cheap).</p>
    <label class="form-label small">Delete reports and votes older than (days)</label><div class="input-group input-group-sm mb-2"><input id="days" type="number" class="form-control" value="90" min="7"><button class="btn btn-danger" id="purge">Delete</button></div><div id="purge-out" class="small"></div></div></div></div></div>`;
  let rows = null;
  $('#run-an').onclick = async () => {
    $('#an-out').textContent = 'Counting…';
    const since = Timestamp.fromMillis(Date.now() - 30 * 864e5);
    const c = (parts) => getCountFromServer(query(collection(db, 'reports'), ...parts)).then((s) => s.data().count);
    try {
      rows = await Promise.all(areas.map(async (a) => { const [n, h] = await Promise.all([c([where('locationId', '==', a.id), where('createdAt', '>=', since)]), c([where('locationId', '==', a.id), where('level', '==', 'heavy'), where('createdAt', '>=', since)])]); return [a.name_en, n, n ? Math.round(100 * h / n) : 0]; }));
      rows.sort((x, y) => y[1] - x[1]);
      $('#an-out').innerHTML = '<table class="table table-sm"><thead><tr><th>Area</th><th>Reports</th><th>Heavy %</th></tr></thead><tbody>' + rows.filter((r) => r[1]).map((r) => `<tr><td>${esc(r[0])}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('') + '</tbody></table>';
      $('#exp-an').classList.remove('d-none');
    } catch (err) { $('#an-out').textContent = err.code + ' (a missing index? open the browser console for the create-index link)'; console.error(err); }
  };
  $('#exp-an').onclick = () => download('jamkoi-area-analytics-30d.csv', csv([['area', 'reports_30d', 'heavy_pct'], ...rows]));
  $('#purge').onclick = async () => {
    const days = Math.max(7, parseInt($('#days').value, 10) || 90);
    if (!confirm(`Delete all reports and votes older than ${days} days?`)) return;
    const cutoff = Timestamp.fromMillis(Date.now() - days * 864e5);
    let total = 0;
    try {
      for (const col of ['reports', 'votes']) {
        for (;;) {
          const snap = await getDocs(query(collection(db, col), where('createdAt', '<', cutoff), limit(400)));
          if (snap.empty) break;
          const b = writeBatch(db); snap.docs.forEach((d) => b.delete(d.ref)); await b.commit(); total += snap.size;
          $('#purge-out').textContent = `Deleted ${total}…`;
        }
      }
      $('#purge-out').textContent = `Done: ${total} documents deleted.`;
    } catch (err) { $('#purge-out').textContent = 'Error: ' + (err.code || err.message); }
  };
}

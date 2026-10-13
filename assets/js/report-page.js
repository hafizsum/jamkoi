/* Shareable report page: ?id=REPORT_ID */
import { initPage } from './layout.js';
import * as C from './core.js';
import { subscribeLive } from './live.js';
import { isConfigured, db, doc, getDoc } from './fb.js';
import { bindVoting } from './actions.js';

const { tr, esc } = C;
await C.loadLocations();
initPage('map');
const id = new URLSearchParams(location.search).get('id') || '';
const root = document.getElementById('jk-report-root');
let state = { clusters: [], reports: [] }, map = null, historical = null, tried = false;

root.innerHTML = `<nav aria-label="breadcrumb" class="small mb-2"><a href="${esc(C.ROOT)}">${esc(tr('nav.map'))}</a></nav>
<div class="jk-grid jk-grid-side"><div id="rp-info"></div><div><div id="rp-map" class="jk-report-map" role="img" aria-label="${esc(tr('map.aria'))}"></div>
<a class="btn jk-btn-primary w-100 mt-3" href="${esc(C.ROOT + 'index.html?i=' + encodeURIComponent(id))}">${esc(tr('report.open_map'))}</a></div></div>`;
const info = document.getElementById('rp-info');

const when = (ms) => new Date(ms).toLocaleString(C.lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function view() {
  const inc = state.clusters.find((c) => c.ids.includes(id));
  const rep = state.reports.find((r) => r.id === id) || historical;
  if (!rep && !inc) { info.innerHTML = `<div class="jk-card"><h1 class="h4">${esc(tr('err.not_found_title'))}</h1><p class="text-muted">${esc(tr('err.not_found'))}</p></div>`; return; }
  const live = !!inc;
  const type = (inc || rep).type, level = inc ? inc.level : rep.level;
  const locId = inc ? inc.locationId : rep.locationId;
  const loc = locId && C.LOC_BY_ID.get(locId);
  const road = inc ? inc.road_name : rep.road;
  const place = [road, loc && C.name(loc)].filter(Boolean).join(', ') || tr('js.unknown_place');
  const ageMin = Math.round((Date.now() - rep.createdAt) / 60000);
  document.title = `${tr('type.' + type)} - ${place} | ${C.APP.siteName}`;
  const url = C.reportUrl(id);
  let body = `<div class="jk-card mb-3"><div class="d-flex flex-wrap align-items-center gap-2 mb-2"><span class="jk-hero-level"><span class="jk-dot jk-dot-${level}" aria-hidden="true"></span>${esc(tr('level.' + level))}</span>` +
    `<span class="fs-5"><span aria-hidden="true">${C.ICONS[type]}</span> ${esc(tr('type.' + type))}</span></div><h1 class="h3">${esc(place)}</h1>` +
    ((inc ? inc.description : rep.desc) ? `<p class="fs-6">“${esc(inc ? inc.description : rep.desc)}”</p>` : '') +
    `<p class="text-muted mb-2">${esc(tr('report.reported_at', { ago: C.ago(ageMin), time: when(rep.createdAt) }))}</p>`;
  if (!live) body += `<div class="alert alert-secondary" role="status">${esc(tr('report.expired'))}</div>`;
  else {
    body += `<div class="mb-2">${C.confBadge(inc)}</div><ul class="mb-2"><li>${esc(tr('js.reports_n', { n: C.num(inc.independent) }))}</li>` +
      `<li>${esc(tr('report.confirms_disputes', { c: C.num(inc.confirms), d: C.num(inc.disputes) }))}</li>` +
      `<li>${esc(tr('report.expires_in', { n: C.num(inc.expires_in_min) }))}</li></ul>` +
      `<p class="small text-muted">${esc(tr('report.conf_explain'))} <a href="${esc(C.ROOT + 'about.html#trust')}">${esc(tr('report.how_calc'))}</a></p>` +
      (inc.disputed ? `<div class="alert alert-warning">${esc(tr('report.disputed'))}</div>` : '') +
      `<div class="d-flex flex-wrap gap-2"><button type="button" class="btn btn-success" data-vote="confirm" data-id="${esc(id)}">✔ ${esc(tr('js.still_there'))}</button>` +
      `<button type="button" class="btn btn-outline-danger" data-vote="dispute" data-id="${esc(id)}">✖ ${esc(tr('js.not_there'))}</button></div>` +
      `<p class="small text-muted mt-2 mb-0">${esc(tr('report.vote_hint'))}</p>`;
  }
  body += `</div><div class="jk-card mb-3"><h2 class="h6">${esc(tr('share.share'))}</h2><div class="d-flex flex-wrap gap-2">` +
    `<a class="btn btn-outline-success" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(place + ' ' + url)}">WhatsApp</a>` +
    `<a class="btn btn-outline-primary" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}">Facebook</a>` +
    `<button type="button" class="btn btn-outline-secondary" id="rp-copy">${esc(tr('share.copy'))}</button></div></div>` +
    (live && level !== 'clear' ? `<a class="btn btn-primary me-2" href="${esc(C.ROOT + 'routes.html?avoid=' + encodeURIComponent(id))}">🧭 ${esc(tr('js.alt_road'))}</a>` : '') +
    (loc ? `<a class="btn btn-outline-dark" href="${esc(C.areaUrl(loc.id))}">${esc(C.name(loc))} →</a>` : '');
  info.innerHTML = body;
  document.getElementById('rp-copy').onclick = async () => { try { await navigator.clipboard.writeText(url); C.toast(tr('js.copied'), 'success'); } catch (e) { prompt(tr('share.copy'), url); } };
  if (!map) {
    map = L.map('rp-map', { scrollWheelZoom: false }).setView([rep.lat, rep.lng], 16);
    L.tileLayer(C.APP.tileUrl, { maxZoom: 19, attribution: C.APP.tileAttribution }).addTo(map);
    L.circleMarker([rep.lat, rep.lng], { radius: 11, weight: 4, color: C.COLORS[level], fillColor: '#fff', fillOpacity: 1 }).addTo(map);
  }
}

bindVoting(() => state.reports);
subscribeLive(async (s) => {
  state = s;
  const found = s.reports.some((r) => r.id === id);
  if (!found && !tried && isConfigured && !s.demo) {      // older than the live window: read the single document
    tried = true;
    try {
      const d = await getDoc(doc(db, 'reports', id));
      if (d.exists()) { const x = d.data(); historical = { id, uid: x.uid, type: x.type, level: x.level, lat: x.lat, lng: x.lng, road: x.road || '', desc: x.desc || '', locationId: x.locationId || null, createdAt: x.createdAt.toMillis(), expiresAt: x.expiresAt.toMillis() }; }
    } catch (e) { /* not found / no permission */ }
  }
  view();
});

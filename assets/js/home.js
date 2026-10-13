/* Home: live map of community traffic reports. */
import { initPage } from './layout.js';
import * as C from './core.js';
import { subscribeLive, reportsLast24h } from './live.js';
import { castVote } from './actions.js';
import { loadSponsored } from './ads.js';
import { initReportForm } from './report-form.js';
import { overview } from './trust.js';

const { tr, esc } = C;
await C.loadLocations();
initPage('map');

const M = C.APP.map;
const map = L.map('jk-map', { minZoom: 6, maxBounds: L.latLngBounds([[20.0, 87.5], [27.3, 93.3]]) }).setView([M.lat, M.lng], M.zoom);
L.tileLayer(C.APP.tileUrl, { maxZoom: 19, attribution: C.APP.tileAttribution }).addTo(map);
L.control.scale({ imperial: false }).addTo(map);
const layer = L.layerGroup().addTo(map), sponsoredLayer = L.layerGroup().addTo(map);

let state = { clusters: [], hotspots: [], reports: [], votes: [], demo: false };
const filt = { level: 'all', verified: false };
const markers = {};
const statusEl = document.getElementById('jk-map-status');

const pinIcon = (inc) => L.divIcon({
  className: 'jk-pin-wrap', iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -18],
  html: `<div class="jk-pin jk-pin-${inc.level} jk-pin-${inc.confidence_label}"><span aria-hidden="true">${C.ICONS[inc.type]}</span>${inc.reports > 1 ? `<b>${C.num(inc.reports)}</b>` : ''}</div>`,
});
const visible = (c) => !c.disputed && (filt.level === 'all' || c.level === filt.level) && !(filt.verified && c.confidence_label === 'low');

function render() {
  const open = layer.getLayers().find((m) => m.isPopupOpen && m.isPopupOpen());
  const openId = open && open._jkId;
  layer.clearLayers();
  for (const k of Object.keys(markers)) delete markers[k];
  const list = state.clusters.filter(visible);
  for (const inc of list) {
    const m = L.marker([inc.lat, inc.lng], { icon: pinIcon(inc), keyboard: true, title: `${tr('type.' + inc.type)} - ${tr('level.' + inc.level)}`, alt: tr('type.' + inc.type) });
    m._jkId = inc.id;
    m.bindPopup(() => C.popupHtml(inc), { minWidth: 230, maxWidth: 300 });
    m.addTo(layer);
    inc.ids.forEach((i) => { markers[i] = m; });
    if (inc.id === openId) setTimeout(() => m.openPopup(), 0);
  }
  statusEl.textContent = state.error ? tr('js.live_error') : (list.length ? '' : tr('js.no_reports'));
  statusEl.classList.toggle('d-none', !statusEl.textContent);

  const ul = document.getElementById('jk-recent');
  const recent = [...list].sort((a, b) => a.age_min - b.age_min).slice(0, 15);
  ul.innerHTML = recent.length ? recent.map(C.listItemHtml).join('')
    : `<li class="jk-empty">${esc(tr('js.no_reports'))} <button class="btn btn-link p-0" data-bs-toggle="modal" data-bs-target="#jk-report-modal">${esc(tr('js.be_first'))}</button></li>`;
  const hot = document.getElementById('jk-hot');
  hot.innerHTML = state.hotspots.length ? state.hotspots.slice(0, 8).map(C.hotItemHtml).join('') : `<li class="jk-empty">${esc(tr('js.no_hotspots'))}</li>`;

  const o = overview(state.clusters);
  setStat('active_incidents', o.active_incidents); setStat('heavy_incidents', o.heavy_incidents);
}
const setStat = (k, v) => { const n = document.querySelector(`[data-stat="${k}"]`); if (n) n.textContent = C.num(v); };

const stop = subscribeLive((s) => { state = s; render(); });
reportsLast24h().then((n) => setStat('reports_24h', n)).catch(() => {});

loadSponsored().then((items) => {
  items.forEach((s) => {
    const m = L.marker([s.lat, s.lng], { icon: L.divIcon({ className: 'jk-pin-wrap', html: '<div class="jk-pin jk-pin-sponsor"><span aria-hidden="true">⭐</span></div>', iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -16] }), title: C.name(s) });
    m.bindPopup(`<div class="jk-pop"><span class="jk-ad-tag">${esc(tr('ad.sponsored'))}</span><strong class="d-block">${esc(C.name(s))}</strong><small>${esc(s.description || '')}</small>` +
      (s.phone ? `<div><a href="tel:${esc(s.phone)}">${esc(s.phone)}</a></div>` : '') + '</div>').addTo(sponsoredLayer);
  });
}).catch(() => {});
const sp = document.getElementById('jk-sponsored-toggle');
if (sp) sp.addEventListener('change', () => (sp.checked ? sponsoredLayer.addTo(map) : sponsoredLayer.remove()));

/* filters */
document.querySelectorAll('.jk-chips .jk-chip').forEach((chip) => chip.addEventListener('click', () => {
  if (chip.dataset.level) { filt.level = chip.dataset.level; document.querySelectorAll('.jk-chip[data-level]').forEach((c) => c.classList.toggle('is-on', c === chip)); }
  else { filt.verified = !filt.verified; chip.classList.toggle('is-on', filt.verified); chip.setAttribute('aria-pressed', String(filt.verified)); }
  render();
}));

function focusIncident(id) {
  const m = markers[id];
  if (!m) return false;
  map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 15), { duration: 0.6 });
  setTimeout(() => m.openPopup(), 650);
  return true;
}
document.addEventListener('click', (ev) => {
  const a = ev.target.closest('.jk-item[data-fly]');
  if (a) { ev.preventDefault(); const [la, ln] = a.dataset.fly.split(',').map(Number); map.flyTo([la, ln], 15); document.getElementById('jk-map').scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  const b = ev.target.closest('.jk-item[data-incident]');
  if (b && markers[b.dataset.incident] && matchMedia('(min-width: 992px)').matches) { ev.preventDefault(); focusIncident(b.dataset.incident); }
});

/* voting (popups) */
document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-vote]');
  if (!b || b.disabled) return;
  b.disabled = true;
  try {
    const pos = await C.getPosition(3500);
    await castVote(b.dataset.id, b.dataset.vote, pos, state.reports);
    C.toast(tr('js.vote_thanks'), 'success');
  } catch (e) { C.toast(e.message, 'danger'); } finally { b.disabled = false; }
});

/* locate */
let me = null;
document.getElementById('jk-locate').addEventListener('click', async () => {
  const p = await C.getPosition(9000);
  if (!p) return C.toast(tr('js.geo_denied'), 'warning');
  me?.remove();
  me = L.layerGroup([L.circle([p.lat, p.lng], { radius: Math.min(p.acc || 50, 500), color: '#2563eb', weight: 1, fillOpacity: 0.12 }),
    L.circleMarker([p.lat, p.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 })]).addTo(map);
  map.flyTo([p.lat, p.lng], 15);
});
document.getElementById('jk-refresh').addEventListener('click', () => { reportsLast24h().then((n) => setStat('reports_24h', n)).catch(() => {}); render(); });

/* search (local data: no reads) */
const input = document.getElementById('jk-search'), box = document.getElementById('jk-search-results');
const hide = () => { box.classList.add('d-none'); input.setAttribute('aria-expanded', 'false'); };
input.addEventListener('input', () => {
  const q = input.value.trim();
  if (!q) return hide();
  const r = C.search(q);
  const rows = [
    ...r.locations.map((x) => ({ t: '📍', label: C.name(x), sub: tr('js.area'), lat: x.lat, lng: x.lng, z: x.kind === 'district' ? 12 : 15 })),
    ...r.roads.map((x) => ({ t: '🛣️', label: C.name(x), sub: C.name({ name_bn: x.loc_name_bn, name_en: x.loc_name_en }), lat: x.lat, lng: x.lng, z: 16 })),
    ...state.clusters.filter((c) => !c.disputed && ((c.road_name || '').toLowerCase().includes(q.toLowerCase()) || (c.description || '').toLowerCase().includes(q.toLowerCase())))
      .slice(0, 5).map((c) => ({ t: C.ICONS[c.type], label: C.placeLine(c), sub: tr('level.' + c.level), inc: c.id, lat: c.lat, lng: c.lng, z: 16 })),
  ];
  box._rows = rows;
  box.innerHTML = rows.length ? rows.map((x, i) => `<li class="list-group-item list-group-item-action" role="option" tabindex="0" data-i="${i}">${x.t} <strong>${esc(x.label)}</strong> <small class="text-muted">${esc(x.sub)}</small></li>`).join('')
    : `<li class="list-group-item text-muted">${esc(tr('js.no_results'))}</li>`;
  box.classList.remove('d-none'); input.setAttribute('aria-expanded', 'true');
});
const pick = (li) => { if (!li || li.dataset.i === undefined) return; const x = box._rows[Number(li.dataset.i)]; hide(); input.value = x.label; map.flyTo([x.lat, x.lng], x.z); if (x.inc) setTimeout(() => focusIncident(x.inc), 700); };
box.addEventListener('click', (e) => pick(e.target.closest('li')));
box.addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(e.target.closest('li')); });
document.addEventListener('click', (e) => { if (!e.target.closest('.jk-searchbar')) hide(); });
input.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });

initReportForm({ getLive: () => state.reports, onReported: (id) => setTimeout(() => focusIncident(id), 1200) });

const deep = new URLSearchParams(location.search).get('i');
if (deep) { let tries = 0; const t = setInterval(() => { if (focusIncident(deep) || ++tries > 20) clearInterval(t); }, 500); }
window.addEventListener('pagehide', stop);

/* Route comparison: OSRM free-flow routes + live community incidents (labelled estimates). */
import { initPage } from './layout.js';
import * as C from './core.js';
import { subscribeLive } from './live.js';
import { compareRoutes, RouteError } from './routing.js';
import { bindVoting } from './actions.js';

const { tr, esc } = C;
await C.loadLocations();
initPage('routes');

const M = C.APP.map;
const map = L.map('rt-map', { minZoom: 6 }).setView([M.lat, M.lng], 11);
L.tileLayer(C.APP.tileUrl, { maxZoom: 19, attribution: C.APP.tileAttribution }).addTo(map);
const ends = { from: null, to: null }, markers = { from: null, to: null };
const routeLayer = L.layerGroup().addTo(map), incLayer = L.layerGroup().addTo(map);
const palette = ['#2563eb', '#7c3aed', '#0f766e', '#c2410c'];
let picking = null, last = null, selected = 0, state = { clusters: [], reports: [] };
const avoidId = new URLSearchParams(location.search).get('avoid');
let avoidShown = false;
subscribeLive((s) => {
  state = s;
  const inc = avoidId && s.clusters.find((c) => c.ids.includes(avoidId));
  if (inc && !avoidShown) {
    avoidShown = true;
    const place = C.placeLine(inc) || tr('js.unknown_place');
    document.getElementById('rt-hint').textContent = tr('route.avoid_hint', { place });
    map.setView([inc.lat, inc.lng], 14);
    L.circleMarker([inc.lat, inc.lng], { radius: 11, color: '#fff', weight: 2, fillColor: C.COLORS[inc.level], fillOpacity: 1 }).bindPopup(C.popupHtml(inc)).addTo(map);
    C.getPosition(8000).then((p) => { if (p && !ends.from) setEnd('from', p.lat, p.lng, tr('js.my_location')); });
  }
});
bindVoting(() => state.reports);

function setEnd(k, lat, lng, label) {
  ends[k] = { lat, lng, label: label || '' };
  document.getElementById('rt-' + k).value = label || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const tip = tr(k === 'from' ? 'route.from' : 'route.to');
  if (markers[k]) markers[k].setLatLng([lat, lng]);
  else markers[k] = L.marker([lat, lng], { title: tip }).addTo(map).bindTooltip(tip, { permanent: true, direction: 'top' });
  if (!last) map.fitBounds(L.latLngBounds(Object.values(markers).filter(Boolean).map((m) => m.getLatLng())).pad(0.4), { maxZoom: 15 });
}

for (const k of ['from', 'to']) {
  const input = document.getElementById('rt-' + k), box = document.getElementById(`rt-${k}-results`);
  input.addEventListener('input', () => {
    ends[k] = null;
    const q = input.value.trim();
    if (!q) return box.classList.add('d-none');
    const r = C.search(q);
    const rows = [...r.locations.map((x) => ({ label: C.name(x), sub: tr('js.area'), lat: x.lat, lng: x.lng })),
      ...r.roads.map((x) => ({ label: C.name(x), sub: C.name({ name_bn: x.loc_name_bn, name_en: x.loc_name_en }), lat: x.lat, lng: x.lng }))];
    box._rows = rows;
    box.innerHTML = rows.length ? rows.map((x, i) => `<li class="list-group-item list-group-item-action" role="option" tabindex="0" data-i="${i}"><strong>${esc(x.label)}</strong> <small class="text-muted">${esc(x.sub)}</small></li>`).join('')
      : `<li class="list-group-item text-muted">${esc(tr('js.no_results'))}</li>`;
    box.classList.remove('d-none');
  });
  const choose = (li) => { if (!li || li.dataset.i === undefined) return; const x = box._rows[Number(li.dataset.i)]; box.classList.add('d-none'); setEnd(k, x.lat, x.lng, x.label); };
  box.addEventListener('click', (e) => choose(e.target.closest('li')));
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter') choose(e.target.closest('li')); });
}
document.querySelectorAll('[data-gps]').forEach((b) => b.addEventListener('click', async () => {
  const p = await C.getPosition(9000);
  if (!p) return C.toast(tr('js.geo_denied'), 'warning');
  setEnd(b.dataset.gps, p.lat, p.lng, tr('js.my_location')); map.setView([p.lat, p.lng], 14);
}));
document.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
  picking = b.dataset.pick;
  document.getElementById('rt-hint').textContent = tr('route.tap_to_set', { which: tr(picking === 'from' ? 'route.from' : 'route.to') });
  map.getContainer().style.cursor = 'crosshair';
}));
map.on('click', (e) => {
  const k = picking || (!ends.from ? 'from' : !ends.to ? 'to' : null);
  if (!k) return;
  setEnd(k, e.latlng.lat, e.latlng.lng, ''); picking = null; map.getContainer().style.cursor = '';
  document.getElementById('rt-hint').textContent = tr('route.hint');
});
document.getElementById('rt-swap').addEventListener('click', () => {
  const a = ends.from, b = ends.to;
  if (a) setEnd('to', a.lat, a.lng, a.label); else { ends.to = null; document.getElementById('rt-to').value = ''; }
  if (b) setEnd('from', b.lat, b.lng, b.label); else { ends.from = null; document.getElementById('rt-from').value = ''; }
});

document.getElementById('jk-route-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const err = document.getElementById('rt-error'), out = document.getElementById('rt-results');
  err.classList.add('d-none');
  if (!ends.from || !ends.to) { err.textContent = tr('route.need_both'); return err.classList.remove('d-none'); }
  const btn = document.getElementById('rt-go');
  btn.disabled = true; out.innerHTML = `<div class="jk-empty">${esc(tr('common.loading'))}</div>`;
  try {
    last = await compareRoutes(ends.from, ends.to, state.clusters, { osrmUrl: C.APP.osrmUrl });
    selected = last.recommended; render();
  } catch (e) {
    out.innerHTML = '';
    let msg = e instanceof RouteError ? tr('err.' + e.code) : tr('err.server_error');
    if (e.extra && e.extra.straight_km) msg += ' ' + tr('route.straight', { km: C.num(e.extra.straight_km) });
    err.textContent = msg; err.classList.remove('d-none');
  } finally { btn.disabled = false; }
});

function render() {
  const out = document.getElementById('rt-results'), r = last;
  const sg = r.suggestion;
  const jamPlace = sg ? (sg.jam.road_name || '') + (sg.jam.locationId && C.LOC_BY_ID.get(sg.jam.locationId) ? ((sg.jam.road_name ? ', ' : '') + C.name(C.LOC_BY_ID.get(sg.jam.locationId))) : '') || tr('js.unknown_place') : '';
  const banner = !sg ? '' : sg.detour_index !== null
    ? `<div class="alert alert-success py-2 small" role="status">🧭 ${esc(tr('route.jam_banner', { level: tr('level.' + sg.jam.level), place: jamPlace, n: C.num(sg.saves_min) }))}</div>`
    : `<div class="alert alert-warning py-2 small" role="status">${esc(tr('route.no_detour', { place: jamPlace }))}</div>`;
  out.innerHTML = banner + `<div class="small text-muted mb-2">${esc(tr('route.method'))}${r.peak_hour ? ' ' + esc(tr('route.peak_note')) : ''}</div>` + r.routes.map((x, i) => {
    const range = x.range_min[0] === x.range_min[1] ? '' : `<div class="small">${esc(tr('route.range', { a: C.num(x.range_min[0]), b: C.num(x.range_min[1]) }))}</div>`;
    const basis = x.basis === 'baseline' ? tr('route.basis_baseline') : tr('route.basis_adjusted', { conf: tr('conf.' + x.estimate_confidence) });
    const incs = x.incidents.slice(0, 4).map((c) => `<li>${C.ICONS[c.type]} ${esc(C.placeLine(c) || tr('type.' + c.type))} – ${esc(tr('level.' + c.level))} (${esc(tr('conf.' + c.confidence_label))}, ${esc(C.ago(c.age_min))})</li>`).join('');
    return `<div class="jk-card jk-route-card mb-2${i === selected ? ' is-sel' : ''}" data-i="${i}" tabindex="0" role="button" aria-pressed="${i === selected}">` +
      `<div class="d-flex justify-content-between align-items-start"><div><span style="color:${palette[i % 4]}">●</span> <strong>${esc(tr('route.option', { n: C.num(i + 1) }))}</strong>` +
      (x.recommended ? ` <span class="badge text-bg-success">${esc(tr('route.recommended'))}</span>` : '') + (x.detour ? ` <span class="badge text-bg-primary">${esc(tr('route.detour'))}</span>` : '') + (i === r.fastest_free_flow ? ` <span class="badge text-bg-secondary">${esc(tr('route.shortest_free'))}</span>` : '') +
      `</div><span class="jk-tag-est">${esc(tr('route.estimate_label'))}</span></div>` +
      `<div class="jk-estimate mt-2">~${C.num(x.estimate_min)} ${esc(tr('route.min'))}</div>${range}` +
      `<div class="small text-muted">${esc(tr('route.free_flow', { n: C.num(x.free_flow_min) }))} · ${C.num(x.distance_km)} ${esc(tr('route.km'))}</div><div class="small mt-1">${esc(basis)}</div>` +
      (x.detour ? `<div class="small text-primary mt-1">${esc(tr('route.avoids', { place: jamPlace }))} · ${esc(tr('route.saves', { n: C.num(x.saves_min) }))}</div>` : '') +
      (x.closure_warning ? `<div class="alert alert-danger py-1 px-2 mt-2 mb-0 small">⛔ ${esc(tr('route.closure_warning'))}</div>` : '') +
      (x.incident_count ? `<div class="small mt-2 fw-semibold">${esc(tr('route.on_route', { n: C.num(x.incident_count) }))}</div><ul class="small mb-0 ps-3">${incs}</ul>` : '') + '</div>';
  }).join('');
  draw();
}
function draw() {
  routeLayer.clearLayers(); incLayer.clearLayers();
  let bounds = null;
  last.routes.forEach((x, i) => {
    const sel = i === selected;
    const line = L.polyline(x.geometry, { color: palette[i % 4], weight: sel ? 7 : 4, opacity: sel ? 0.95 : 0.5, dashArray: sel ? null : '8 8' }).addTo(routeLayer);
    if (sel) { line.bringToFront(); bounds = line.getBounds(); }
  });
  last.routes[selected].incidents.forEach((c) => L.circleMarker([c.lat, c.lng], { radius: 9, color: '#fff', weight: 2, fillColor: C.COLORS[c.level], fillOpacity: 1 }).bindPopup(C.popupHtml(c)).addTo(incLayer));
  if (bounds) map.fitBounds(bounds.pad(0.15));
}
const results = document.getElementById('rt-results');
results.addEventListener('click', (e) => { const c = e.target.closest('.jk-route-card'); if (c && last) { selected = Number(c.dataset.i); render(); } });
results.addEventListener('keydown', (e) => { if (e.key !== 'Enter' && e.key !== ' ') return; const c = e.target.closest('.jk-route-card'); if (c && last) { e.preventDefault(); selected = Number(c.dataset.i); render(); } });

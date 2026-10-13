/* Anonymous report form (modal on the home page). */
import * as C from './core.js';
import { submitReport } from './actions.js';
import { nearestArea } from './geo.js';

export function initReportForm({ getLive, onReported }) {
  const { tr } = C;
  const modalEl = document.getElementById('jk-report-modal');
  const form = document.getElementById('jk-report-form');
  const errBox = document.getElementById('rf-error'), statusEl = document.getElementById('rf-geo-status');
  const sel = document.getElementById('rf-location'), road = document.getElementById('rf-road'), desc = document.getElementById('rf-desc');
  const submit = document.getElementById('rf-submit'), success = document.getElementById('rf-success');
  const M = C.APP.map;
  let mini = null, pin = null, precision = null;
  const pos = { lat: null, lng: null };

  // area <select> grouped by district, from the static JSON
  const groups = C.LOCATIONS.filter((l) => l.kind === 'district');
  sel.innerHTML = `<option value="">${C.esc(tr('report.choose_area'))}</option>` + groups.map((g) =>
    `<optgroup label="${C.esc(C.name(g))}">${C.LOCATIONS.filter((a) => a.kind === 'area' && a.parent === g.id).map((a) => `<option value="${a.id}">${C.esc(C.name(a))}</option>`).join('')}</optgroup>`).join('');

  const setStatus = (m) => { statusEl.textContent = m; };
  const showError = (msg, html) => { errBox.textContent = msg; if (html) errBox.insertAdjacentHTML('beforeend', html); errBox.classList.remove('d-none'); errBox.scrollIntoView({ block: 'nearest' }); };

  function placePin(lat, lng, prec) {
    pos.lat = lat; pos.lng = lng; precision = prec;
    if (!pin) {
      pin = L.marker([lat, lng], { draggable: true }).addTo(mini);
      pin.on('dragend', () => { const p = pin.getLatLng(); pos.lat = p.lat; pos.lng = p.lng; precision = 'pin'; setStatus(tr('js.pin_set')); });
    } else pin.setLatLng([lat, lng]);
    setStatus(prec === 'gps' ? tr('js.gps_set') : tr('js.pin_set'));
  }
  function ensureMap() {
    if (mini) { setTimeout(() => mini.invalidateSize(), 50); return; }
    mini = L.map('rf-map', { minZoom: 6 }).setView([M.lat, M.lng], 12);
    L.tileLayer(C.APP.tileUrl, { maxZoom: 19, attribution: C.APP.tileAttribution }).addTo(mini);
    mini.on('click', (e) => placePin(e.latlng.lat, e.latlng.lng, 'pin'));
    setTimeout(() => mini.invalidateSize(), 50);
  }
  function loadRoads() {
    document.getElementById('rf-roads').innerHTML = sel.value
      ? C.roadsFor(sel.value).map((r) => `<option value="${C.esc(C.lang === 'bn' ? r.bn : r.en)}">`).join('') : '';
  }
  sel.addEventListener('change', () => {
    const l = C.LOC_BY_ID.get(sel.value);
    if (l && mini) mini.setView([l.lat, l.lng], 15);
    loadRoads();
  });
  document.getElementById('rf-gps').addEventListener('click', async () => {
    setStatus(tr('js.locating'));
    const p = await C.getPosition(10000);
    if (!p) return setStatus(tr('js.geo_denied'));
    ensureMap(); mini.setView([p.lat, p.lng], 16); placePin(p.lat, p.lng, 'gps');
    const a = nearestArea(p.lat, p.lng, C.LOCATIONS);
    if (a && !sel.value) { sel.value = a.id; loadRoads(); }
  });
  desc.addEventListener('input', () => { document.getElementById('rf-count').textContent = C.num(desc.value.length); });
  modalEl.addEventListener('show.bs.modal', () => { errBox.classList.add('d-none'); form.classList.remove('d-none'); success.classList.add('d-none'); });
  modalEl.addEventListener('shown.bs.modal', ensureMap);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errBox.classList.add('d-none');
    const fd = new FormData(form);
    if (fd.get('website')) { showSuccess({ id: null }); return; }        // honeypot: look successful, store nothing
    submit.disabled = true;
    const label = submit.textContent; submit.textContent = tr('js.sending');
    try {
      const res = await submitReport({
        type: fd.get('type'), level: fd.get('level'), locationId: fd.get('location_id') || null, road: fd.get('road_name') || '',
        description: fd.get('description') || '', lat: pos.lat, lng: pos.lng, precision: precision || 'pin',
      }, getLive());
      showSuccess(res);
    } catch (e) {
      if (e.code === 'duplicate' && e.extra.id) showError(e.message + ' ', `<a href="${C.esc(C.reportUrl(e.extra.id))}">${C.esc(tr('js.details'))}</a>`);
      else showError(e.message);
    } finally { submit.disabled = false; submit.textContent = label; }
  });

  function showSuccess(res) {
    form.classList.add('d-none'); success.classList.remove('d-none');
    if (!res.id) return;
    const url = C.reportUrl(res.id), text = tr('js.share_text');
    document.getElementById('rf-view').href = url;
    document.getElementById('rf-wa').href = 'https://wa.me/?text=' + encodeURIComponent(text + ' ' + url);
    const sb = document.getElementById('rf-share');
    sb.classList.toggle('d-none', !navigator.share);
    sb.onclick = () => navigator.share({ title: 'JamKoi', text, url }).catch(() => {});
    document.getElementById('rf-copy').onclick = async () => { try { await navigator.clipboard.writeText(url); C.toast(tr('js.copied'), 'success'); } catch (e) { prompt(tr('share.copy'), url); } };
    form.reset(); document.getElementById('rf-count').textContent = '0';
    pos.lat = pos.lng = null; precision = null; if (pin) { pin.remove(); pin = null; } setStatus(tr('report.tap_map'));
    onReported && onReported(res.id);
  }

  if (new URLSearchParams(location.search).get('report') === '1') bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

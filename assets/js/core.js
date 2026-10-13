/* Shared UI helpers: i18n, formatting, locations data, markup builders, toast. No Firebase here. */
import { STRINGS } from './strings.js';
import { APP } from '../../firebase-config.js';

export const ROOT = new URL('../../', import.meta.url).href;

/* ---------- language ---------- */
const qp = new URLSearchParams(location.search);
if (['bn', 'en'].includes(qp.get('lang'))) { try { localStorage.setItem('jk_lang', qp.get('lang')); } catch (e) { /* ignore */ } }
export const lang = (() => { try { const l = localStorage.getItem('jk_lang'); return l === 'en' ? 'en' : 'bn'; } catch (e) { return 'bn'; } })();
export function setLang(l) { try { localStorage.setItem('jk_lang', l); } catch (e) { /* ignore */ } const u = new URL(location.href); u.searchParams.delete('lang'); location.href = u.href; }

export function tr(key, vars) {
  let s = (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key;
  if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}
export const num = (n) => { const s = String(n); return lang === 'bn' ? s.replace(/[0-9]/g, (d) => '০১২৩৪৫৬৭৮৯'[d]) : s; };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const name = (row) => (row ? ((lang === 'bn' ? row.name_bn : row.name_en) || row.name_en || row.name_bn || '') : '');
export function ago(min) {
  min = Math.max(0, Math.round(min));
  if (min < 1) return tr('time.now');
  if (min < 60) return tr('time.min_ago', { n: num(min) });
  if (min < 1440) return tr('time.hr_ago', { n: num(Math.floor(min / 60)) });
  return tr('time.day_ago', { n: num(Math.floor(min / 1440)) });
}
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = tr(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = tr(el.dataset.i18nPh); });
  root.querySelectorAll('[data-i18n-label]').forEach((el) => { el.setAttribute('aria-label', tr(el.dataset.i18nLabel)); });
  document.documentElement.lang = lang;
}

/* ---------- constants ---------- */
export const ICONS = { congestion: '🚗', accident: '💥', closure: '⛔', waterlogging: '🌊', roadwork: '🚧' };
export const COLORS = { heavy: '#d6332b', moderate: '#e59b00', clear: '#1e9e5a' };
export const TYPES = ['congestion', 'accident', 'closure', 'waterlogging', 'roadwork'];
export const reportUrl = (id) => `${ROOT}report.html?id=${encodeURIComponent(id)}`;
export const areaUrl = (slug) => `${ROOT}area.html?slug=${encodeURIComponent(slug)}`;

/* ---------- locations (static JSON in the repo: zero database reads) ---------- */
let locPromise = null;
export let LOCATIONS = [], ROADS = [], LOC_BY_ID = new Map();
export function loadLocations() {
  locPromise ??= fetch(ROOT + 'data/locations.json').then((r) => r.json()).then((d) => {
    LOCATIONS = d.locations; ROADS = d.roads; LOC_BY_ID = new Map(LOCATIONS.map((l) => [l.id, l])); return d;
  });
  return locPromise;
}
export const roadsFor = (locId) => ROADS.filter((r) => r.loc === locId);

export function search(q, limitN = 8) {
  q = q.trim().toLowerCase();
  if (!q) return { locations: [], roads: [], incidents: [] };
  const hit = (a, b) => (a || '').toLowerCase().includes(q) || (b || '').toLowerCase().includes(q);
  const pref = (a, b) => (a || '').toLowerCase().startsWith(q) || (b || '').toLowerCase().startsWith(q);
  const locations = LOCATIONS.filter((l) => hit(l.name_bn, l.name_en)).sort((a, b) => pref(b.name_bn, b.name_en) - pref(a.name_bn, a.name_en) || (a.kind === 'area' ? -1 : 1)).slice(0, limitN);
  const roads = ROADS.filter((r) => hit(r.bn, r.en)).slice(0, limitN).map((r) => {
    const l = LOC_BY_ID.get(r.loc);
    return { name_bn: r.bn, name_en: r.en, loc_name_bn: l.name_bn, loc_name_en: l.name_en, lat: l.lat, lng: l.lng, location_id: l.id };
  });
  return { locations, roads, incidents: [] };
}

/* ---------- markup ---------- */
export const levelBadge = (level) => `<span class="jk-lvl jk-lvl-${level}"><span class="jk-dot jk-dot-${level}" aria-hidden="true"></span>${esc(tr('level.' + level))}</span>`;
export const confBadge = (inc) => `<span class="jk-conf-badge jk-conf-${inc.confidence_label}" title="${esc(tr('js.conf_hint'))}">${esc(tr('conf.' + inc.confidence_label))} · ${num(Math.round(inc.confidence * 100))}%</span>`;
export function incidentMeta(inc) {
  const p = [tr('js.reports_n', { n: num(inc.independent) })];
  if (inc.confirms) p.push(tr('js.confirms_n', { n: num(inc.confirms) }));
  if (inc.disputes) p.push(tr('js.disputes_n', { n: num(inc.disputes) }));
  p.push(ago(inc.age_min));
  return p.join(' · ');
}
export function placeLine(inc) {
  const bits = [];
  if (inc.road_name) bits.push(inc.road_name);
  const l = inc.locationId && LOC_BY_ID.get(inc.locationId);
  if (l) bits.push(name(l));
  return bits.join(', ');
}
const votedKey = 'jk_votes';
export const votedMap = () => { try { return JSON.parse(localStorage.getItem(votedKey) || '{}'); } catch (e) { return {}; } };
export const rememberVote = (id, v) => { try { const m = votedMap(); m[id] = v; localStorage.setItem(votedKey, JSON.stringify(m)); } catch (e) { /* ignore */ } };

export function popupHtml(inc) {
  const v = votedMap()[inc.id], place = placeLine(inc);
  return `<div class="jk-pop"><div class="jk-pop-head">${levelBadge(inc.level)}<span class="jk-type">${ICONS[inc.type]} ${esc(tr('type.' + inc.type))}</span></div>` +
    (place ? `<div class="jk-pop-place">${esc(place)}</div>` : '') +
    (inc.description ? `<p class="jk-pop-desc">${esc(inc.description)}</p>` : '') +
    `<div class="jk-pop-conf">${confBadge(inc)}</div><div class="jk-pop-meta">${esc(incidentMeta(inc))}</div>` +
    `<div class="jk-pop-actions"><button type="button" class="btn btn-sm btn-success${v === 'confirm' ? ' active' : ''}" data-vote="confirm" data-id="${esc(inc.id)}">✔ ${esc(tr('js.still_there'))}</button>` +
    `<button type="button" class="btn btn-sm btn-outline-danger${v === 'dispute' ? ' active' : ''}" data-vote="dispute" data-id="${esc(inc.id)}">✖ ${esc(tr('js.not_there'))}</button>` +
    `<a class="btn btn-sm btn-outline-dark" href="${esc(reportUrl(inc.id))}">${esc(tr('js.details'))}</a>` +
    (inc.level !== 'clear' ? `<a class="btn btn-sm btn-outline-primary" href="${esc(ROOT + 'routes.html?avoid=' + encodeURIComponent(inc.id))}">🧭 ${esc(tr('js.alt_road'))}</a>` : '') + '</div></div>';
}
export const listItemHtml = (inc) => `<li><a class="jk-item jk-item-${inc.level}" href="${esc(reportUrl(inc.id))}" data-incident="${esc(inc.id)}">` +
  `<span class="jk-item-ico" aria-hidden="true">${ICONS[inc.type]}</span><span class="jk-item-body"><strong>${esc(placeLine(inc) || tr('js.unknown_place'))}</strong>` +
  `<span class="jk-item-sub">${levelBadge(inc.level)} ${confBadge(inc)}</span><span class="jk-item-meta">${esc(incidentMeta(inc))}</span></span></a></li>`;
export const hotItemHtml = (x) => `<li><a class="jk-item jk-item-${x.level}" href="${esc(areaUrl(x.slug))}" data-fly="${x.lat},${x.lng}">` +
  `<span class="jk-item-ico" aria-hidden="true">${ICONS[x.top_type]}</span><span class="jk-item-body"><strong>${esc(name(x))}</strong>` +
  `<span class="jk-item-sub">${levelBadge(x.level)} <span class="jk-score">${num(x.score)}/100</span></span>` +
  `<span class="jk-item-meta">${esc(tr('js.incidents_n', { n: num(x.incidents) }) + ' · ' + ago(x.updated_min))}</span></span></a></li>`;

/* ---------- UI ---------- */
export function toast(msg, type = 'dark') {
  const box = document.getElementById('jk-toasts');
  if (!box || !window.bootstrap) { alert(msg); return; }
  const d = document.createElement('div');
  d.className = 'toast align-items-center border-0 text-bg-' + type;
  d.setAttribute('role', type === 'danger' ? 'alert' : 'status');
  d.innerHTML = `<div class="d-flex"><div class="toast-body"></div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="${esc(tr('js.close'))}"></button></div>`;
  d.querySelector('.toast-body').textContent = msg;
  box.appendChild(d);
  d.addEventListener('hidden.bs.toast', () => d.remove());
  new bootstrap.Toast(d, { delay: 4500 }).show();
}

export function getPosition(timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      () => resolve(null), { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 });
  });
}

export { APP };

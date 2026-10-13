/* Dashboard (dashboard.html) and area pages (area.html?slug=): live hotspots + historical charts via cheap count() aggregates. */
import { initPage } from './layout.js';
import * as C from './core.js';
import { subscribeLive, reportsLast24h, votesLast24h } from './live.js';
import { isConfigured, db, collection, query, where, getCountFromServer, Timestamp } from './fb.js';
import { overview } from './trust.js';

const { tr, esc } = C;
await C.loadLocations();
initPage('dashboard');

const slug = new URLSearchParams(location.search).get('slug');
const areaPage = document.getElementById('ar-title') !== null;
const area = areaPage ? C.LOC_BY_ID.get(slug) : null;
let fixedLoc = area ? area.id : '';
if (areaPage && !area) { document.getElementById('main').innerHTML = `<h1 class="h3">${esc(tr('err.not_found_title'))}</h1><p>${esc(tr('err.not_found'))}</p>`; throw new Error('unknown area'); }
if (area) {
  document.getElementById('ar-title').textContent = tr('area.title', { name: C.name(area) });
  document.title = tr('area.title', { name: C.name(area) }) + ' | ' + C.APP.siteName;
  document.getElementById('ar-ad').dataset.area = area.id;
}

Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
Chart.defaults.maintainAspectRatio = false;
const charts = {};
const draw = (id, cfg) => { const c = document.getElementById(id); if (!c) return; charts[id]?.destroy(); charts[id] = new Chart(c, cfg); };
const setStat = (k, v) => { const n = document.querySelector(`[data-stat="${k}"]`); if (n) n.textContent = C.num(v); };

/* ----- live part ----- */
subscribeLive((s) => {
  const o = overview(s.clusters);
  ['active_incidents', 'verified_incidents', 'heavy_incidents'].forEach((k) => setStat(k, o[k]));
  const hot = document.getElementById('dash-hot');
  if (hot) hot.innerHTML = s.hotspots.length ? s.hotspots.slice(0, 10).map(C.hotItemHtml).join('') : `<li class="jk-empty">${esc(tr('js.no_hotspots'))}</li>`;

  const rows = s.hotspots.slice(0, 12);
  draw('chart-areas', { type: 'bar', data: { labels: rows.map((r) => C.name(r)), datasets: [{ label: tr('js.live_score'), data: rows.map((r) => r.score), backgroundColor: rows.map((r) => C.COLORS[r.level]) }] },
    options: { indexAxis: 'y', scales: { x: { min: 0, max: 100 } }, plugins: { legend: { display: false } } } });

  if (area) {
    const h = s.hotspots.find((x) => x.slug === area.id);
    document.getElementById('ar-status').innerHTML = h
      ? `<span class="jk-hero-level"><span class="jk-dot jk-dot-${h.level}" aria-hidden="true"></span>${esc(tr('level.' + h.level))} · ${C.num(h.score)}/100</span> <span class="text-muted ms-2">${esc(tr('js.incidents_n', { n: C.num(h.incidents) }) + ' · ' + C.ago(h.updated_min))}</span>`
      : `<span class="jk-hero-level">${esc(tr('area.no_data'))}</span>`;
    const mine = s.clusters.filter((c) => !c.disputed && c.locationId === area.id).sort((a, b) => a.age_min - b.age_min);
    document.getElementById('ar-list').innerHTML = mine.length ? mine.map(C.listItemHtml).join('') : `<li class="jk-empty">${esc(tr('js.no_reports'))}</li>`;
  }
});
if (document.querySelector('[data-stat="reports_24h"]')) reportsLast24h().then((n) => setStat('reports_24h', n)).catch(() => {});
if (document.querySelector('[data-stat="votes_24h"]')) votesLast24h().then((n) => setStat('votes_24h', n)).catch(() => {});

/* ----- history (aggregate counts; cached 30 min in localStorage) ----- */
const off = C.APP.utcOffsetHours;
async function count(parts) { return (await getCountFromServer(query(collection(db, 'reports'), ...parts))).data().count; }
const memo = async (key, fn) => {
  const k = 'jk_hist_' + key;
  try { const c = JSON.parse(localStorage.getItem(k) || 'null'); if (c && Date.now() - c.t < 30 * 60000) return c.v; } catch (e) { /* ignore */ }
  const v = await fn();
  try { localStorage.setItem(k, JSON.stringify({ t: Date.now(), v })); } catch (e) { /* ignore */ }
  return v;
};

async function hourly(loc) {
  if (!isConfigured) return Array.from({ length: 24 }, (_, h) => { const lh = (h + off) % 24; const base = [0,0,0,0,0,1,2,5,9,9,6,4,4,4,4,5,7,9,9,8,5,3,2,1][lh]; return { h: lh, total: base * 12, heavy: Math.round(base * 12 * (0.2 + base / 14)) }; });
  return memo(`h_${loc}`, async () => {
    const since = Timestamp.fromMillis(Date.now() - 30 * 864e5);
    const base = loc ? [where('locationId', '==', loc)] : [];
    return Promise.all(Array.from({ length: 24 }, async (_, h) => {
      const [total, heavy] = await Promise.all([
        count([...base, where('utcHour', '==', h), where('createdAt', '>=', since)]),
        count([...base, where('utcHour', '==', h), where('level', '==', 'heavy'), where('createdAt', '>=', since)]),
      ]);
      return { h: (h + off) % 24, total, heavy };
    }));
  });
}
async function daily(loc) {
  const days = 14, dhakaMidnight = (i) => { const d = new Date(Date.now() + off * 3600e3); d.setUTCHours(0, 0, 0, 0); return d.getTime() - off * 3600e3 - i * 864e5; };
  const labels = [];
  for (let i = days - 1; i >= 0; i--) labels.push(new Date(dhakaMidnight(i) + off * 3600e3).toISOString().slice(5, 10));
  if (!isConfigured) return { labels, heavy: labels.map((_, i) => 20 + (i * 7) % 15), moderate: labels.map((_, i) => 30 + (i * 5) % 12), clear: labels.map((_, i) => 10 + (i * 3) % 8) };
  return memo(`d_${loc}`, async () => {
    const base = loc ? [where('locationId', '==', loc)] : [];
    const out = { labels, heavy: [], moderate: [], clear: [] };
    await Promise.all(['heavy', 'moderate', 'clear'].map(async (lvl) => {
      out[lvl] = await Promise.all(Array.from({ length: days }, (_, k) => {
        const i = days - 1 - k, s = Timestamp.fromMillis(dhakaMidnight(i)), e = Timestamp.fromMillis(dhakaMidnight(i) + 864e5);
        return count([...base, where('level', '==', lvl), where('createdAt', '>=', s), where('createdAt', '<', e)]);
      }));
    }));
    return out;
  });
}

async function history() {
  const loc = fixedLoc || (document.getElementById('dash-loc') || {}).value || '';
  try {
    const h = (await hourly(loc)).sort((a, b) => a.h - b.h);
    draw('chart-hourly', { data: { labels: h.map((x) => C.num(x.h) + (C.lang === 'bn' ? 'টা' : ':00')),
      datasets: [{ type: 'bar', label: tr('js.reports'), data: h.map((x) => x.total), backgroundColor: '#2563eb55', yAxisID: 'y' },
        { type: 'line', label: tr('js.heavy_share'), data: h.map((x) => (x.total >= 3 ? Math.round(100 * x.heavy / x.total) : null)), borderColor: '#d6332b', backgroundColor: '#d6332b', spanGaps: true, tension: .3, yAxisID: 'y1' }] },
      options: { scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, y1: { min: 0, max: 100, position: 'right', grid: { drawOnChartArea: false } } }, plugins: { legend: { position: 'bottom' } } } });
    const d = await daily(loc);
    draw('chart-daily', { type: 'bar', data: { labels: d.labels, datasets: ['heavy', 'moderate', 'clear'].map((l) => ({ label: tr('level.' + l), data: d[l], backgroundColor: C.COLORS[l] })) },
      options: { scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'bottom' } } } });
  } catch (e) { console.error(e); C.toast(tr('js.load_failed'), 'warning'); }
}

const sel = document.getElementById('dash-loc');
if (sel) {
  sel.innerHTML = `<option value="">${esc(tr('dash.all_areas'))}</option>` + C.LOCATIONS.filter((l) => l.kind === 'district').map((g) =>
    `<optgroup label="${esc(C.name(g))}">${C.LOCATIONS.filter((a) => a.parent === g.id && a.kind === 'area').map((a) => `<option value="${a.id}">${esc(C.name(a))}</option>`).join('')}</optgroup>`).join('');
  sel.addEventListener('change', history);
}
history();

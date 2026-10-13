/* Injects the shared header, bottom tab bar, footer and toast area; registers the service worker. */
import { ROOT, tr, lang, setLang, applyI18n, esc } from './core.js';
import { APP, isConfigured } from '../../firebase-config.js';
import { loadSettings, renderAdSlots } from './ads.js';
import { setupState } from './fb.js';

export function initPage(nav = '') {
  const site = APP.siteName;
  const other = lang === 'bn' ? 'en' : 'bn';
  const L = (p) => esc(ROOT + p);
  const header = `
<a class="visually-hidden-focusable jk-skip" href="#main">${esc(tr('a11y.skip'))}</a>
<header class="jk-header"><div class="jk-header-in">
  <a class="jk-brand" href="${L('')}" aria-label="${esc(site)}">
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#ffc83d"/><rect x="11" y="4" width="10" height="24" rx="5" fill="#17212b"/><circle cx="16" cy="10" r="2.6" fill="#e5483d"/><circle cx="16" cy="16" r="2.6" fill="#f2a900"/><circle cx="16" cy="22" r="2.6" fill="#22a45d"/></svg>
    <span>${esc(site)}</span></a>
  <nav class="jk-nav d-none d-lg-flex" aria-label="${esc(tr('a11y.main_nav'))}">
    ${[['map', '', 'nav.map'], ['dashboard', 'dashboard.html', 'nav.dashboard'], ['routes', 'routes.html', 'nav.routes'], ['about', 'about.html', 'nav.about'], ['business', 'business.html', 'nav.business']]
      .map(([k, p, l]) => `<a href="${L(p)}" ${nav === k ? 'aria-current="page"' : ''}>${esc(tr(l))}</a>`).join('')}
  </nav>
  <div class="jk-header-actions">
    <button type="button" class="btn btn-sm jk-btn-ghost d-none" data-jk-install>${esc(tr('pwa.install'))}</button>
    <button type="button" class="btn btn-sm jk-btn-ghost" id="jk-lang" lang="${other}">${other === 'en' ? 'English' : 'বাংলা'}</button>
    <a class="btn btn-sm jk-btn-primary d-none d-lg-inline-flex" href="${L('index.html?report=1')}">${esc(tr('nav.report'))}</a>
  </div></div></header>
<div id="jk-announce" class="jk-announce d-none" role="status"></div>
${isConfigured ? '' : `<div class="jk-announce" role="status">${esc(tr('cfg.missing'))}</div>`}`;
  document.body.insertAdjacentHTML('afterbegin', header);

  const tab = ([k, p, ico, l]) => `<a ${k === 'report' ? 'class="jk-tab-report"' : ''} href="${L(p)}" ${nav === k ? 'aria-current="page"' : ''}><span aria-hidden="true">${ico}</span>${esc(tr(l))}</a>`;
  document.body.insertAdjacentHTML('beforeend', `
<footer class="jk-footer"><div class="container">
  <p class="mb-1">${esc(tr('footer.disclaimer'))}</p>
  <p class="mb-0 small"><a href="${L('about.html')}">${esc(tr('nav.about'))}</a> · <a href="${L('business.html')}">${esc(tr('nav.business'))}</a> ·
  <span>Map data &copy; <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap</a></span></p></div></footer>
<nav class="jk-tabbar d-lg-none" aria-label="${esc(tr('a11y.main_nav'))}">
  ${[['map', '', '🗺️', 'nav.map'], ['routes', 'routes.html', '🧭', 'nav.routes'], ['report', 'index.html?report=1', '＋', 'nav.report'], ['dashboard', 'dashboard.html', '📊', 'nav.dashboard'], ['about', 'about.html', 'ℹ️', 'nav.about']].map(tab).join('')}
</nav>
<div class="toast-container position-fixed top-0 end-0 p-3" style="z-index:2000" id="jk-toasts" aria-live="polite" aria-atomic="true"></div>`);

  if (document.body.dataset.title) document.title = tr(document.body.dataset.title) + ' | ' + site;
  document.getElementById('jk-lang').addEventListener('click', () => setLang(other));
  applyI18n();

  loadSettings().then((s) => {
    const msg = s['announcement_' + lang];
    if (msg) { const a = document.getElementById('jk-announce'); a.textContent = msg; a.classList.remove('d-none'); }
  });
  renderAdSlots();

  // First run: no config / no admin yet -> send the owner to the setup wizard (visitors can still peek in demo mode).
  const demo = new URLSearchParams(location.search).get('demo') === '1' || sessionStorage.getItem('jk_demo') === '1';
  if (new URLSearchParams(location.search).get('demo') === '1') sessionStorage.setItem('jk_demo', '1');
  setupState().then((st) => {
    if (st === 'unconfigured' && !demo) location.replace(ROOT + 'setup.html');
    else if (st === 'needs_setup') location.replace(ROOT + 'setup.html');
    else if (st === 'rules') {
      const a = document.getElementById('jk-announce');
      a.innerHTML = 'Firestore rules are not deployed yet. <a href="' + esc(ROOT + 'setup.html') + '">Open setup</a>'; a.classList.remove('d-none');
    }
  });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    window.addEventListener('load', () => navigator.serviceWorker.register(ROOT + 'sw.js', { scope: ROOT }).catch(() => {}));
  }
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; document.querySelectorAll('[data-jk-install]').forEach((b) => b.classList.remove('d-none')); });
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-jk-install]') || !deferred) return;
    deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null;
    document.querySelectorAll('[data-jk-install]').forEach((b) => b.classList.add('d-none'));
  });
}

/* Site settings, ad slots and sponsored listings from Firestore (cached in sessionStorage to save reads). */
import { isConfigured, db, collection, query, where, getDocs, getDoc, doc, updateDoc, increment } from './fb.js';
import { esc, tr, lang, name, ROOT } from './core.js';

const DEFAULTS = { adsEnabled: true, sponsoredEnabled: true, showPlaceholders: true, announcement_bn: '', announcement_en: '', slots: {} };
const cached = async (key, ttlMs, fn) => {
  try { const c = JSON.parse(sessionStorage.getItem(key) || 'null'); if (c && Date.now() - c.t < ttlMs) return c.v; } catch (e) { /* ignore */ }
  const v = await fn();
  try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch (e) { /* ignore */ }
  return v;
};
const tsMs = (t) => (t && t.toMillis ? t.toMillis() : null);

export function loadSettings() {
  if (!isConfigured) return Promise.resolve({ ...DEFAULTS });
  return cached('jk_settings', 10 * 60000, async () => {
    try { const s = await getDoc(doc(db, 'settings', 'public')); return { ...DEFAULTS, ...(s.exists() ? s.data() : {}) }; } catch (e) { return { ...DEFAULTS }; }
  });
}

async function loadCollection(col, key) {
  if (!isConfigured) return [];
  return cached(key, 10 * 60000, async () => {
    try {
      const snap = await getDocs(query(collection(db, col), where('isActive', '==', true)));
      return snap.docs.map((d) => { const x = d.data(); return { id: d.id, ...x, startsAt: tsMs(x.startsAt), endsAt: tsMs(x.endsAt), createdAt: tsMs(x.createdAt) }; });
    } catch (e) { return []; }
  });
}
const inWindow = (x) => (!x.startsAt || x.startsAt <= Date.now()) && (!x.endsAt || x.endsAt >= Date.now());

export async function loadSponsored() {
  const s = await loadSettings();
  return s.sponsoredEnabled ? (await loadCollection('sponsors', 'jk_sponsors')).filter(inWindow) : [];
}

/** Fill every <div data-ad-slot="home_top" [data-area="farmgate"]> on the page. */
export async function renderAdSlots(root = document) {
  const slots = [...root.querySelectorAll('[data-ad-slot]')];
  if (!slots.length) return;
  const s = await loadSettings();
  if (!s.adsEnabled) return;
  const ads = (await loadCollection('ads', 'jk_ads')).filter(inWindow);
  for (const el of slots) {
    if (s.slots && s.slots[el.dataset.adSlot] === false) continue;   // this ad spot is switched off in Admin → Settings
    const pool = ads.filter((a) => a.placement === el.dataset.adSlot && (!a.locationId || a.locationId === el.dataset.area));
    const ad = pool[Math.floor(Math.random() * pool.length)];
    if (ad && /^https?:\/\//i.test(ad.linkUrl || '')) {
      const img = /^https:\/\//i.test(ad.imageUrl || '') ? `<img src="${esc(ad.imageUrl)}" alt="" loading="lazy" class="jk-ad-img">` : '';
      el.innerHTML = `<aside class="jk-ad" aria-label="${esc(tr('ad.label'))}"><span class="jk-ad-tag">${esc(tr('ad.sponsored'))}</span>` +
        `<a href="${esc(ad.linkUrl)}" rel="sponsored nofollow noopener" target="_blank" class="jk-ad-link" data-ad-id="${esc(ad.id)}">${img}<strong>${esc(ad.title)}</strong>` +
        (ad.body ? `<span>${esc(ad.body)}</span>` : '') + '</a></aside>';
    } else if (s.showPlaceholders) {
      el.innerHTML = `<aside class="jk-ad jk-ad-empty" aria-label="${esc(tr('ad.label'))}"><span class="jk-ad-tag">${esc(tr('ad.label'))}</span>` +
        `<a href="${esc(ROOT + 'business.html')}" class="jk-ad-link"><strong>${esc(tr('ad.here'))}</strong><span>${esc(tr('ad.here_sub'))}</span></a></aside>`;
    }
  }
}

// Click counter (rules only allow clicks +1 on an active ad).
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-ad-id]');
  if (!a || !isConfigured) return;
  updateDoc(doc(db, 'ads', a.dataset.adId), { clicks: increment(1) }).catch(() => {});
});

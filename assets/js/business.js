import { initPage } from './layout.js';
import * as C from './core.js';
import { loadSettings } from './ads.js';
import { isConfigured, db, ensureUser, doc, setDoc, serverTimestamp } from './fb.js';

const { tr, esc } = C;
await C.loadLocations();
initPage('business');

document.getElementById('sub-loc').innerHTML = `<option value="">${esc(tr('dash.all_areas'))}</option>` + C.LOCATIONS.filter((l) => l.kind === 'district').map((g) =>
  `<optgroup label="${esc(C.name(g))}">${C.LOCATIONS.filter((a) => a.parent === g.id && a.kind === 'area').map((a) => `<option value="${a.id}">${esc(C.name(a))}</option>`).join('')}</optgroup>`).join('');

const email = C.APP.contactEmail;
if (email) { const p = document.getElementById('biz-contact'); p.classList.remove('d-none'); p.innerHTML = `${esc(tr('biz.contact'))} <a href="mailto:${esc(email)}">${esc(email)}</a>`; }

const f = document.getElementById('jk-sub-form'), msg = document.getElementById('sub-msg');
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.className = 'small';
  const fd = new FormData(f);
  if (fd.get('website')) { msg.textContent = tr('js.sub_ok'); return; }
  const channel = fd.get('channel') === 'sms' ? 'sms' : 'email';
  let contact = String(fd.get('contact') || '').trim();
  if (channel === 'email') { contact = contact.toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact)) return fail('err.invalid_contact'); }
  else { contact = contact.replace(/[\s-]/g, '').replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d)); if (!/^(\+?88)?01[3-9][0-9]{8}$/.test(contact)) return fail('err.invalid_contact'); }
  if (!fd.get('consent')) return fail('err.consent_required');
  if (!isConfigured) return fail('err.demo_mode');
  try {
    const u = await ensureUser();
    const data = { channel, contact, minLevel: 'heavy', consent: true, createdAt: serverTimestamp() };
    if (fd.get('location_id')) data.locationId = fd.get('location_id');
    await setDoc(doc(db, 'subscriptions', u.uid), data);
    msg.className = 'small text-success'; msg.textContent = tr('js.sub_ok'); f.reset();
  } catch (err) { console.error(err); fail(err.code === 'permission-denied' ? 'err.permission' : 'err.server_error'); }
});
function fail(key) { msg.className = 'small text-danger'; msg.textContent = tr(key); }
loadSettings();

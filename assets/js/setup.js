/* First-run wizard: (1) paste Firebase config, (2) check rules + sign-in, (3) create the admin and initial documents. */
import { FIREBASE_CONFIG, APP, isConfigured, configFromBrowser } from '../../firebase-config.js';
import {
  app, auth, db, setupState, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInAnonymously, signOut,
  doc, writeBatch, serverTimestamp,
} from './fb.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mark = (n, state) => { const el = $('#n' + n); el.className = 'num' + (state === 'ok' ? ' ok' : state === 'off' ? ' off' : ''); el.textContent = state === 'ok' ? '✓' : n; };
const flash = (html, type = 'danger') => { $('#alert').innerHTML = `<div class="alert alert-${type}">${html}</div>`; window.scrollTo(0, 0); };
const root = new URL('../../', import.meta.url).href;

/* ---------- step 1: connection ---------- */
function parseConfig(text) {
  const out = {};
  for (const m of text.matchAll(/["']?(apiKey|authDomain|projectId|storageBucket|messagingSenderId|appId|measurementId)["']?\s*:\s*["']([^"']+)["']/g)) out[m[1]] = m[2];
  return out;
}
function step1() {
  if (isConfigured) {
    mark(1, 'ok');
    $('#s1').innerHTML = `<div class="small">Connected to project <code>${esc(FIREBASE_CONFIG.projectId)}</code>${configFromBrowser ? ' <span class="badge text-bg-warning">stored in this browser only</span>' : ''}.</div>` +
      (configFromBrowser ? `<div class="small text-muted mt-1">To make it permanent for every visitor, download the file below and replace <code>firebase-config.js</code> in your repo, then commit.</div>
        <button class="btn btn-sm btn-outline-dark mt-2" id="dl">Download firebase-config.js</button> <button class="btn btn-sm btn-link text-danger" id="forget">Forget</button>` : '');
    $('#dl')?.addEventListener('click', () => download(FIREBASE_CONFIG));
    $('#forget')?.addEventListener('click', () => { localStorage.removeItem('jk_fb_config'); location.reload(); });
    return;
  }
  mark(1);
  $('#s1').innerHTML = `<p class="small text-muted mb-2">Firebase console → Project settings → General → Your apps → Web app → copy the <code>firebaseConfig</code> and paste it here. (These keys are not secrets: your Firestore rules protect the data.)</p>
    <textarea id="cfg" class="form-control font-monospace" rows="8" placeholder="const firebaseConfig = {&#10;  apiKey: &quot;...&quot;,&#10;  authDomain: &quot;...&quot;,&#10;  projectId: &quot;...&quot;,&#10;  appId: &quot;...&quot;&#10;};"></textarea>
    <div class="d-flex gap-2 mt-2 flex-wrap"><button class="btn btn-y" id="save">Save &amp; continue</button><button class="btn btn-outline-dark" id="dl">Download firebase-config.js</button></div>
    <p class="small text-muted mt-2 mb-0">Save keeps it in this browser so you can finish setup now. Download gives you the file to commit to GitHub so everyone gets it.</p>`;
  const read = () => { const c = parseConfig($('#cfg').value); const miss = ['apiKey', 'authDomain', 'projectId', 'appId'].filter((k) => !c[k]); if (miss.length) { flash('Missing in the pasted text: <b>' + miss.join(', ') + '</b>'); return null; } return c; };
  $('#save').onclick = () => { const c = read(); if (!c) return; localStorage.setItem('jk_fb_config', JSON.stringify(c)); location.reload(); };
  $('#dl').onclick = () => { const c = read(); if (c) download(c); };
}
async function download(cfg) {
  const src = await (await fetch(root + 'firebase-config.js')).text();
  const body = '{\n' + ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'].filter((k) => cfg[k]).map((k) => `  ${k}: ${JSON.stringify(cfg[k])},`).join('\n') + '\n}';
  const out = src.replace(/const FILE_CONFIG = \{[\s\S]*?\n\};/, 'const FILE_CONFIG = ' + body + ';');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([out], { type: 'text/javascript' })); a.download = 'firebase-config.js'; a.click();
}

/* ---------- step 2: rules + sign-in ---------- */
async function step2(state) {
  if (state === 'done' || state === 'needs_setup') {
    mark(2, 'ok');
    $('#s2').innerHTML = '<span class="text-success">Firestore reachable and rules deployed.</span>' + (state === 'needs_setup' ? ' <button class="btn btn-sm btn-outline-dark ms-2" id="chk">Test sign-in</button><span id="chk-out" class="ms-2"></span>' : '');
    $('#chk')?.addEventListener('click', async () => {
      $('#chk-out').textContent = '…';
      try { await signInAnonymously(auth); await signOut(auth); $('#chk-out').innerHTML = '<span class="text-success">Anonymous sign-in works ✓</span>'; }
      catch (e) { $('#chk-out').innerHTML = `<span class="text-danger">${esc(e.code || e.message)} – enable <b>Anonymous</b> in Authentication → Sign-in method.</span>`; }
    });
    return;
  }
  mark(2);
  $('#s2').className = '';
  $('#s2').innerHTML = `<div class="alert alert-warning py-2 small">Firestore says <code>permission-denied</code>: the rules are not deployed yet (or the Firestore database was not created).</div>
    <ol class="small">
      <li>Firebase console → <b>Build → Firestore Database → Create database</b> (production mode) if you have not.</li>
      <li>Open <code>firestore.rules</code>, change <code>CHANGE_ME_SETUP_CODE</code> to a long random <b>setup code</b> (keep it; you type it in step 3). Do not commit that change.</li>
      <li>Deploy: <code>firebase deploy --only firestore</code>, or paste the file into <b>Firestore → Rules → Publish</b>. <button class="btn btn-sm btn-outline-dark ms-1" id="cp">Copy the rules file</button></li>
      <li>Authentication → Sign-in method → enable <b>Anonymous</b> and <b>Email/Password</b>.</li>
    </ol><button class="btn btn-y btn-sm" id="re">Check again</button>`;
  $('#cp').onclick = async () => { try { await navigator.clipboard.writeText(await (await fetch(root + 'firestore.rules')).text()); $('#cp').textContent = 'Copied ✓'; } catch (e) { flash('Could not copy; open firestore.rules from the repo.'); } };
  $('#re').onclick = () => location.reload();
}

/* ---------- step 3: admin ---------- */
function step3(state) {
  if (state === 'done') {
    mark(3, 'ok');
    $('#s3').innerHTML = 'Setup is complete.';
    $('#done').innerHTML = `<div class="card shadow-sm"><div class="card-body"><h2 class="h5">All set ✅</h2><div class="d-flex gap-2 flex-wrap mb-2"><a class="btn btn-y" href="index.html">Open the app</a><a class="btn btn-outline-dark" href="admin/">Admin panel</a></div>
      <ul class="small text-muted mb-0"><li>Replace the setup code in <code>firestore.rules</code> with a new random string and redeploy, so it can never be reused.</li>
      <li>Create the Firestore indexes (history charts): <code>firebase deploy --only firestore</code>, or click the link in the browser console the first time a chart is empty.</li>
      <li>Make the Firebase config permanent: commit <code>firebase-config.js</code>, then enable GitHub Pages.</li></ul></div></div>`;
    return;
  }
  if (state !== 'needs_setup') return;
  mark(3);
  $('#s3').className = '';
  $('#s3').innerHTML = `<form id="f" class="row g-2" autocomplete="off">
    <div class="col-md-6"><label class="form-label small mb-1" for="site">Site name</label><input class="form-control" id="site" value="${esc(APP.siteName)}" maxlength="60"></div>
    <div class="col-md-6"><label class="form-label small mb-1" for="em">Admin email</label><input class="form-control" id="em" type="email" required autocomplete="username"></div>
    <div class="col-md-6"><label class="form-label small mb-1" for="pw">Password (min 10 characters)</label><input class="form-control" id="pw" type="password" minlength="10" required autocomplete="new-password"></div>
    <div class="col-md-6"><label class="form-label small mb-1" for="pw2">Repeat password</label><input class="form-control" id="pw2" type="password" minlength="10" required autocomplete="new-password"></div>
    <div class="col-12"><label class="form-label small mb-1" for="code">Setup code (the value you put in firestore.rules)</label><input class="form-control" id="code" type="password" required autocomplete="off"><div class="form-text">Only someone who knows it can create the first admin.</div></div>
    <div class="col-12"><button class="btn btn-y btn-lg w-100" id="go">Create admin &amp; initialise</button></div></form>`;
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const em = $('#em').value.trim(), pw = $('#pw').value, code = $('#code').value.trim();
    if (pw.length < 10) return flash('Password must be at least 10 characters.');
    if (pw !== $('#pw2').value) return flash('The two passwords do not match.');
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(code)) return flash('The setup code may contain only letters, digits, - and _ (8-100 characters). Use the same value as in firestore.rules.');
    $('#go').disabled = true; $('#go').textContent = 'Working…';
    try {
      let cred;
      try { cred = await createUserWithEmailAndPassword(auth, em, pw); }
      catch (err) { if (err.code === 'auth/email-already-in-use') cred = await signInWithEmailAndPassword(auth, em, pw); else throw err; }
      const uid = cred.user.uid;
      const b = writeBatch(db);
      b.set(doc(db, 'setup_claims', code), { uid });
      b.set(doc(db, 'system', 'setup'), { done: true, adminUid: uid, createdAt: serverTimestamp() });
      b.set(doc(db, 'admins', uid), { role: 'owner', email: em, createdAt: serverTimestamp() });
      b.set(doc(db, 'settings', 'public'), { announcement_bn: '', announcement_en: '', adsEnabled: true, sponsoredEnabled: true, showPlaceholders: true, siteName: $('#site').value.trim() || APP.siteName });
      await b.commit();
      try { localStorage.setItem('jk_setup_done_' + app.options.projectId, '1'); } catch (e2) { /* ignore */ }
      $('#alert').innerHTML = '';
      step3('done');
    } catch (err) {
      console.error(err);
      const hint = { 'auth/operation-not-allowed': 'Enable <b>Email/Password</b> in Authentication → Sign-in method.', 'auth/weak-password': 'Choose a stronger password.', 'auth/invalid-email': 'That email address is not valid.',
        'auth/invalid-credential': 'That email already exists with a different password.', 'permission-denied': 'The rules refused it: the setup code does not match <code>firestore.rules</code>, or setup was already completed.' }[err.code];
      flash(`Setup failed: <code>${esc(err.code || err.message)}</code> ${hint || ''}`);
      $('#go').disabled = false; $('#go').textContent = 'Create admin & initialise';
    }
  });
}

/* ---------- run ---------- */
step1();
if (isConfigured) {
  const state = await setupState();
  await step2(state);
  step3(state);
}

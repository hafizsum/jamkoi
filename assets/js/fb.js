/* Firebase wrapper (modular SDK from the official CDN). Only this file talks to Firebase. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, query, where, orderBy, limit, onSnapshot, getDocs, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  writeBatch, serverTimestamp, Timestamp, increment, getCountFromServer,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { initializeAppCheck, ReCaptchaV3Provider } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js';
import { FIREBASE_CONFIG, APP, isConfigured } from '../../firebase-config.js';

export { isConfigured };
export const app = isConfigured ? initializeApp(FIREBASE_CONFIG) : null;

if (app && APP.appCheckSiteKey) {
  try { initializeAppCheck(app, { provider: new ReCaptchaV3Provider(APP.appCheckSiteKey), isTokenAutoRefreshEnabled: true }); }
  catch (e) { console.warn('App Check init failed', e); }
}

export const auth = app ? getAuth(app) : null;
export let db = null;
if (app) {
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (e) { db = getFirestore(app); }   // private mode / unsupported browsers: memory cache
}

/** Anonymous sign-in happens lazily, only when the visitor writes something. Reads need no account. */
export function ensureUser() {
  return new Promise((resolve, reject) => {
    if (!auth) return reject(new Error('demo'));
    if (auth.currentUser) return resolve(auth.currentUser);
    const off = onAuthStateChanged(auth, (u) => {
      if (u) { off(); resolve(u); }
    });
    if (!auth.currentUser) signInAnonymously(auth).catch((e) => { off(); reject(e); });
  });
}

/**
 * First-run state of the project:
 *  'unconfigured' no Firebase config yet | 'rules' Firestore unreachable/locked (rules not deployed)
 *  'needs_setup'  system/setup missing (no admin created yet) | 'done'
 */
export async function setupState() {
  if (!isConfigured) return 'unconfigured';
  const key = 'jk_setup_done_' + app.options.projectId;
  try { if (localStorage.getItem(key) === '1') return 'done'; } catch (e) { /* ignore */ }
  try {
    const d = await getDoc(doc(db, 'system', 'setup'));
    if (d.exists()) { try { localStorage.setItem(key, '1'); } catch (e) { /* ignore */ } return 'done'; }
    return 'needs_setup';
  } catch (e) {
    return 'rules';   // permission-denied (rules not deployed) or database not created yet
  }
}

export {
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signInAnonymously, signOut, onAuthStateChanged,
  collection, doc, query, where, orderBy, limit, onSnapshot, getDocs, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  writeBatch, serverTimestamp, Timestamp, increment, getCountFromServer,
};

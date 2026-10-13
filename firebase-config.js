/**
 * JamKoi (Firebase edition) configuration.
 *
 * 1. Create a Firebase project, add a Web app, and paste its config below
 *    (Project settings -> General -> Your apps -> SDK setup and configuration).
 *    These web keys are NOT secrets: access is controlled by firestore.rules + (optionally) App Check.
 * 2. Easiest: open setup.html, paste the config there, and it also gives you this file ready to download.
 * 3. Leave the "YOUR_" placeholders and the site runs in DEMO mode with sample data (nothing is saved).
 */
const FILE_CONFIG = {
  apiKey: "AIzaSyBylSPIwrqw3R2BdRuTGPV1_M-BW6WCh5c",
  authDomain: "bd-cash-95b56.firebaseapp.com",
  databaseURL: "https://bd-cash-95b56.firebaseio.com",
  projectId: "bd-cash-95b56",
  storageBucket: "bd-cash-95b56.firebasestorage.app",
  messagingSenderId: "100556897585",
  appId: "1:100556897585:web:4ed16ef73cab70f62f8410"

};

export const APP = {
  siteName: 'JamKoi',
  // reCAPTCHA v3 site key for Firebase App Check (recommended; see README). Leave '' to skip.
  appCheckSiteKey: '',
  // Free OSRM demo server (no live traffic, light use only). Self-host or use a provider for production.
  osrmUrl: 'https://router.project-osrm.org',
  // OSM tiles: light use only per the OSM tile policy. Swap for a provider/self-hosted URL for real traffic.
  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  map: { lat: 23.7806, lng: 90.4075, zoom: 11 },
  utcOffsetHours: 6,        // Bangladesh, no DST
  liveWindowHours: 12,      // how far back live reports are loaded
  contactEmail: '',
};

// --- Do not edit below. While this file still has the YOUR_ placeholders, the setup wizard (setup.html) can store the
// --- config in this browser (localStorage) so you can finish setup before committing the file to GitHub.
const placeholder = (c) => String(c.projectId).startsWith('YOUR_');
const stored = (() => { try { return JSON.parse(localStorage.getItem('jk_fb_config') || 'null'); } catch (e) { return null; } })();
export const FIREBASE_CONFIG = placeholder(FILE_CONFIG) && stored && stored.projectId ? stored : FILE_CONFIG;
export const configFromBrowser = FIREBASE_CONFIG !== FILE_CONFIG;
export const isConfigured = !placeholder(FIREBASE_CONFIG);

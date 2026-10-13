# JamKoi (জ্যামকই) – Firebase edition (static site, no server)

Bangla-first, mobile-first community traffic app for Bangladesh. **No PHP, no MySQL, no hosting bill:** the site is plain HTML/JS served by **GitHub Pages**, the data lives in **Cloud Firestore** (Firebase free "Spark" plan), visitors are **Firebase anonymous users** (no sign-up), and the admin signs in with email + password.

Stack: Firebase (Firestore + Anonymous Auth + optional App Check), Bootstrap 5, Leaflet + OpenStreetMap, Chart.js, vanilla ES modules. No build step.

> **Testing status.** I could run the pure logic in Node (`node tests/trust.test.mjs`: trust/confidence maths, clustering, decay, disputes, hotspots, polyline decoding, route estimates, alternative-road suggestion, error paths – 27 checks pass) and syntax-check every JS file. I could **not** run Firebase (no network/emulator in my sandbox), a browser, or the live OSRM server. So `firestore.rules`, the Firestore queries and the page wiring are untested here – follow the **Test checklist** below on your own project before announcing the site. Tell me what breaks and I'll fix it.

## What changed vs the PHP/MySQL edition

| | PHP edition | Firebase edition |
|---|---|---|
| Hosting | PHP + MySQL host | GitHub Pages (static) |
| Database | MySQL | Firestore |
| Identity | device cookie hashed on server | Firebase anonymous auth uid |
| Validation / rate limits | PHP code | **`firestore.rules`** (field validation, 45 s gap, 6 reports/hour per account, blocked users, no self-votes) |
| Trust engine | PHP | same model in JS (`assets/js/trust.js`, runs in the browser) |
| Locations/roads | MySQL tables | `data/locations.json` (edit in the repo) |
| Admin | PHP sessions | `admin/` page + Firebase Auth + `admins/{uid}` |
| Cron clean-up | `bin/maintenance.php` | button in Admin → Analytics & clean-up |

## Quick start (first-run wizard, like a "meal system" style setup)

You only provide **the Firebase API config (which includes your project/database id)**. The app then asks for the admin details and creates everything else.

1. **Firebase console** (free): create a project → **Firestore Database → Create database** (production mode) → **Authentication → Sign-in method → enable Anonymous and Email/Password** → **Project settings → Your apps → Web (`</>`)** and copy the `firebaseConfig`.
2. **Rules:** in `firestore.rules` change `CHANGE_ME_SETUP_CODE` to a long random code (letters/digits/-/_, e.g. `Xk93-ab12-QwErTy77`) and keep it. Deploy the rules: `firebase deploy --only firestore` (CLI) or paste the file in *Firestore → Rules → Publish*. **Do not commit your real setup code.**
3. **Open the site** (`python3 -m http.server 8080` → <http://localhost:8080>, or your GitHub Pages URL). On first run it redirects to **`setup.html`**:
   * **Step 1 – Firebase connection:** paste the `firebaseConfig`. *Save* keeps it in this browser so you can finish now; *Download firebase-config.js* gives you the file to commit so every visitor gets it.
   * **Step 2 – Rules & sign-in:** checks Firestore is reachable and the rules are deployed (with a "Copy rules" helper) and can test anonymous sign-in.
   * **Step 3 – Admin account:** site name, admin email, password and the setup code. It creates the admin login and automatically writes the initial documents (`admins/<uid>`, `system/setup`, `settings/public`) in one atomic batch. The rules only allow this once, and only with your setup code.
4. **Finish:** replace the setup code in `firestore.rules` with a new random string and redeploy; commit `firebase-config.js`; push to GitHub and enable *Settings → Pages → Deploy from a branch → main / root*; add `YOU.github.io` to *Authentication → Settings → Authorized domains*.
5. **Indexes** (history charts): `firebase deploy --only firestore` creates them from `firestore.indexes.json`, or click the link Firebase prints in the browser console the first time a chart is empty.

Until the config is present the site can run in **demo mode** (`?demo=1`): sample incidents, nothing saved.

CLI alternative for step 2: `npm i -g firebase-tools && firebase login && cp .firebaserc.example .firebaserc` (put your project id) `&& firebase deploy --only firestore`.

Run locally (ES modules need http): `python3 -m http.server 8080`.

## Alternative road when there is a jam

* Any non-clear incident popup and report page has a **🧭 Alternative road** button → `routes.html?avoid=<incident>`; it centres on the jam, fills "From" with your GPS position (if allowed) and asks where you are going.
* On the Routes page, if the best route runs through a confident jam (confidence ≥ 45 % and expected delay ≥ 4 min), JamKoi asks the routing server for a route **via a waypoint 700 m beside the jam (both sides)**. A detour is shown only if it **avoids that jam** and its estimate is **lower** than the jammed route's (and not absurdly longer); the page then says e.g. "Heavy jam reported at Mohakhali Flyover. The alternative road below saves about 9 min" and recommends it. If no faster detour exists, it says so instead of inventing one.
* Same honesty rules: times are estimates (free-flow + crowd heuristic), never live speeds. The detour logic is unit-tested in `tests/trust.test.mjs` against a fake routing server (jam on the only road → detour; no jam → no extra request; slower detour rejected; routing error → base route still shown).

## Security model (read this)

There is no server, so **the Firestore rules are the backend**:

* Public can read reports/votes; nothing else is writable except through the validated paths below.
* **Create report:** needs an anonymous account that is not in `blocked/`; strict field whitelist; type/level enums; Bangladesh coordinates; text ≤ 300 chars; links and BD phone numbers rejected in text; `createdAt` must equal server time; lifetime capped per type; **and the same batch must update `users/{uid}`**, whose rule enforces ≥ 45 s between reports and ≤ 6 per hour.
* **Vote:** document id `reportId_uid` = one vote per account per report; cannot vote on your own report or an expired one.
* **Admin:** only uids with an `admins/{uid}` document can delete/modify reports, manage blocked users, ads, sponsors, settings and read the waitlist. Admin writes are impossible from the client for everyone else.
* Waitlist contacts: one entry per account, consent required, readable only by admins.

### What is weaker than the PHP edition
1. **No server-side spam scoring.** Rules can't see IP addresses or run heuristics beyond the checks above. Someone can create many anonymous accounts (Firebase limits anonymous sign-ups to ~100/hour per IP) and flood reports; the trust engine needs *independent accounts*, but accounts are cheap.
2. Mitigations: turn on **App Check** (reCAPTCHA v3: create a site key, set `appCheckSiteKey` in `firebase-config.js`, then *App Check → Firestore → Enforce*); keep an eye on **Admin → Reports**; delete abusive reports and **Block user**. Deleting is the moderation action (a hidden-status flag would still be readable via the API).
3. **No IP damping** and reputation is derived only from votes loaded in the last 12 h.
4. **Link previews** (WhatsApp/Facebook cards) can't show report details, because crawlers don't run JavaScript. Shared links still open the right report.
5. If you outgrow this, add Cloud Functions (needs the Blaze plan with a card) for server-side validation/aggregation; the data model already fits.

## Free-tier budget (Spark plan)
Firestore free quota per day: **50 000 reads, 20 000 writes, 20 000 deletes**, 1 GiB stored. How the app spends it:
* Live map: one initial read per *live* report/vote (last 12 h, capped at 600/1200), then only changes via realtime listeners. Persistent local cache reduces repeat-visit cost.
* Locations/roads/search are a static JSON file: zero reads. Ads/settings are cached in `sessionStorage` for 10 min.
* Dashboard history uses `count()` aggregates (≥ 1 read each, ~100 per load) cached 30 min in `localStorage`.
* Realistically a few hundred active visitors/day on a busy day fit in the free tier. If you exceed it Firestore pauses reads until the next day (the site shows "live updates unavailable"). Upgrade to Blaze or reduce `liveWindowHours` in `firebase-config.js`.

## Routing and map services
* Route geometry/distance/free-flow time: the free **OSRM demo server** called straight from the browser (needs CORS; the demo server has allowed it, but I could not test it). It has **no live traffic** and is for light use. For production self-host OSRM and set `osrmUrl`.
* JamKoi adds a heuristic delay from nearby community incidents and labels everything **"Estimate"** with a range. If the routing call fails you get an honest error + straight-line distance, never an invented time.
* Tiles: OSM's free tile server (light use only). Set `tileUrl` to a provider before real traffic.

## Data model
```
reports/{id}        type, level, lat, lng, precision, [locationId], road, desc, uid, createdAt, expiresAt, utcHour
votes/{reportId_uid} reportId, uid, vote, isNear, createdAt
users/{uid}         lastReportAt, hourStart, hourCount          (throttle; own doc only)
admins/{uid}        (created manually)       blocked/{uid}  createdAt
settings/public     announcement_bn/en, adsEnabled, sponsoredEnabled, showPlaceholders
ads/{id}            placement, title, body, linkUrl, imageUrl, advertiser, [locationId], startsAt, endsAt, isActive, clicks
sponsors/{id}       name_bn/en, category, tier, description, phone, linkUrl, lat, lng, isActive
subscriptions/{uid} channel, contact, [locationId], minLevel, consent, createdAt
```

## Monetization hooks
Ad slots (`data-ad-slot="home_top|home_side|report_page|dashboard|route_page|area_page"`), sponsored map listings, premium-alert waitlist (CSV export), per-area analytics. Ads are always labelled "Sponsored". Impressions aren't counted (would burn writes); clicks are. **Sending** alerts needs an email/SMS provider and a server/Function, not included.

## Editing locations
`data/locations.json` holds districts, areas (with radius) and roads. Edit it in the repo, commit, push. Coordinates are approximate area centres – correct them.

## Test checklist (do this once on your project)
- [ ] `node tests/trust.test.mjs` passes
- [ ] Open the site: it redirects to `setup.html`; paste the config, create the admin, and the wizard shows "All set"
- [ ] Reload `index.html`: no redirect; the map is empty or shows real data
- [ ] Report a jam on a road, then press **🧭 Alternative road** on its popup, set a destination beyond it: a detour card appears (needs the routing server to answer)
- [ ] Submit a report → it appears on the map; submit another within 45 s → friendly "reporting too fast" message
- [ ] Open the share link in a private window; confirm the report from there → confidence rises; try voting on your own report → refused
- [ ] Try a report with `www.example.com` in the text → refused by the client; (optional) try the REST API directly to confirm the rules also refuse it
- [ ] `/admin/`: log in, delete a report, block a user, create an ad (disabled → enable) and see the "Sponsored" box on the home page
- [ ] Dashboard charts load (if empty with a console index link, click the link and wait for the index)
- [ ] Firebase console → Firestore → Rules → *Rules Playground* or the emulator (`firebase emulators:start --only firestore`) for anything you want to double-check
- [ ] Routes page: pick two areas → alternatives with "Estimate" labels, or the honest "routing unavailable / could not be reached" message

## Files
`index.html report.html area.html dashboard.html routes.html about.html business.html admin/` · `firebase-config.js` · `firestore.rules` · `firestore.indexes.json` · `data/locations.json` · `assets/js/{trust,geo,routing}.js` (pure logic, unit-tested) · `assets/js/{fb,live,actions,ads,layout,core,...}.js` · `tests/trust.test.mjs`

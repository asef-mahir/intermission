# Release Issue List

**Status:** Extension implementation and GitHub Pages are ready. GitHub Releases provides manual-install packages; Chrome Web Store submission remains paused. Version 1.0.2 isolates vent-room typing from host-page shortcuts, requests access when a site is added, and refreshes visible check-in copy when the language changes.
**Target:** Chrome Web Store, public release.
**Product name:** **Intermission**.
**Current build:** `1.0.2` (working tree), packaged as `dist/intermission-1.0.2.zip`.
**Last verified:** 2026-11-25 in an isolated Chrome 158 profile.

> The line references in the issue descriptions below describe the original `0.1.0` build. Release hardening was completed in 1.0.0; 1.0.1 refined focus styling; 1.0.2 isolates vent textarea input from page-level shortcuts, aligns new-site checkboxes with permission grants, and updates a visible time-check-in when the language changes.

**Scope lock — these are not changing:**

- Breathing stays exactly as it is: 5 minutes, count-up timer, “Do it again.”
- The current full-screen check-in stays as it is.
- SPA/in-page navigation is not intercepted. The pause runs on full page loads and refreshes only.
- No existing feature is being redesigned.

Every item below is a confirmed defect, a store or packaging requirement, or a verification item that becomes a defect if it fails. Spec-only differences are listed as locked behavior or as decisions, not as bugs.

**Evidence labels:** `[runtime]` = observed in the isolated Chrome smoke test; `[code]` = confirmed by source inspection; `[unverified]` = needs a test before release.

---

## 1. Summary

| ID | Priority | Issue | Type |
|---|---|---|---|
| REL-01 | P0 | Product name conflicts with an existing app | Release/brand |
| REL-02 | P0 | Open-tab injection omits `interceptor.css` | Confirmed defect |
| REL-03 | P0 | Overlay is not modal for keyboard/screen-reader users | Confirmed defect |
| REL-04 | P0 | Page can stay hidden if the content script fails | Confirmed code risk |
| REL-05 | P1 | Hardcoded user-facing strings and initial page language | Confirmed defect |
| REL-06 | P0 | No privacy policy or in-product disclosure | Store compliance |
| REL-07 | P0 | No store listing or assets | Store requirement |
| REL-08 | P0 | No reproducible package or release version | Packaging |
| REL-09 | P1 | Return-to-work fallback is unverified | Verification |
| REL-10 | P1 | Strict-CSP behavior is unverified | Verification |
| REL-11 | P1 | Host access is retained after a site is removed | Privacy/least privilege |

P0 means “must be fixed and verified before submission.” P1 means “must be verified or explicitly accepted before public launch.”

### Implementation status

| ID | Status | What was done / what remains |
|---|---|---|
| REL-01 | **Done** | Renamed user-facing surfaces to “Intermission”; manifest is `1.0.2`. Clean-profile package test finds no old name. Internal IDs unchanged. |
| REL-02 | **Done (code)** | Open-tab injection now inserts `interceptor.css` before the script, removes duplicate CSS, cleans up on disable/removal, and reveals affected tabs. Permission-revocation cleanup is best-effort; the CSS fail-open covers the case where access is already gone. |
| REL-03 | **Done** | Page body is `inert` and `aria-hidden` while the pause is open; focus enters the first action, Tab/Shift+Tab are trapped, focus is restored on dismissal; dialog uses `aria-labelledby`; overlay `lang` follows the language setting. |
| REL-04 | **Done** | CSS-only fail-open verified on a fresh page (hidden at 0.8 s, visible after 8 s). JavaScript startup watchdog added. A deliberately thrown startup error has not been fault-injected separately. |
| REL-05 | **Done** | Remaining check-in/timer literals moved into both language banks; `interception.close` added; options/popup start as `lang="en"` and correct after settings load. |
| REL-06 | **Done** | Policy live at `https://asef-mahir.github.io/intermission/privacy.html`; first-run disclosure added with a stored consent version; store disclosure answers “Web history” and “User activity” as Yes with precise limits. |
| REL-07 | **Done** | Store listing copy, permission justifications, data-use answers, five 1280×800 screenshots, 440×280 tile, and 1400×560 marquee are prepared. |
| REL-08 | **Done** | `scripts/build.js` validates an explicit runtime allowlist, creates `dist/unpacked` and a deterministic ZIP, and the ZIP loads in a clean profile with no service-worker errors. |
| REL-09 | **Verified** | Referrer return navigates back to the work page; direct load with no referrer navigates the tab to `chrome://newtab/`. |
| REL-10 | **Verified (synthetic)** | Overlay renders fully styled under `style-src 'self'` and `style-src 'none'`. Real-site spot checks (GitHub, X, YouTube, Google) are still recommended before submission. |
| REL-11 | **Done** | Turning a site off or removing it calls `chrome.permissions.remove` for that site; turning it on requests access again. Global off keeps access for configured sites and is documented. |

---

## 2. P0 issues

### REL-01 — Rename the product — **Done**

**Evidence:** `[code]` The original `manifest.json:3` used “Focus Friend.” Hank Green’s existing focus app is also named “Focus Friend” (`focusfriend.me`, iOS and Android). The name is generic in the focus category. The user chose **Intermission**, and the user-facing rename is applied.

**Why it blocks:** brand and trademark confusion, possible complaint or takedown, store-review confusion, and a costly rename after listing assets and reviews exist. This is a business risk, not a legal conclusion.

**Exact fix:**

- Choose the final name first. No user-facing rename can start until it is chosen.
- Update only user-facing surfaces:
  - `manifest.json` — `name`, and `description` if it contains the name.
  - `popup.html` — `<title>`, logo `alt`, and the “FOCUS FRIEND” eyebrow.
  - `options.html` — `<title>` and the “FOCUS FRIEND” eyebrow.
  - `content/en.json` — `settings.pageTitle`, `settings.permissionGranted`, `settings.permissionDenied`, `popup.turnOff`, and any other product-name string.
  - `content/bn.json` — `settings.pageTitle` (currently “ফোকাস ফ্রেন্ড — সেটিংস”) and any other product-name string.
  - Store listing, privacy policy, support URL, and screenshots.
- Do not rename internal identifiers: `focus-friend-interceptor`, `focus-friend-overlay-host`, `focus-friend-gentle-pill-host`, `__focusFriendInstance`, and console diagnostics. They are not user-facing, and renaming them adds migration risk for no user benefit.
- The current icon is a leaf with no wordmark, so no icon regeneration is required unless the new name is added to the icon.

**Done when:** no user-facing “Focus Friend” remains; the store listing and policy use the new name; internal IDs are unchanged.

**Status:** Rename is complete in the runtime. The store listing and privacy policy still need to use “Intermission” when they are written.

---

### REL-02 — Inject `interceptor.css` into already-open tabs

**Evidence:** `[code]` `background.js:4` defines `INTERCEPTOR_FILES = ["storage.js", "interceptor.js"]`. `background.js:32–39` registers `interceptor.css` for future page loads. `background.js:78–82` injects only the JS files into open tabs. `[runtime]` After enabling the extension on an open tab, the host existed but computed `position: static`, `display: inline`; the overlay rendered below the page instead of covering it.

**Why it blocks:** enabling the extension, adding a site, or granting access while the tab is already open is a normal first-run action. The user sees a broken page, not a pause screen.

**Exact fix:**

- In `injectIntoOpenTabs`, call `chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["interceptor.css"] })` before `executeScript`.
- Track which tabs received the injected CSS so repeated enable/add-site/permission events do not stack duplicates. Remove the CSS when the site is disabled or removed, the host permission is revoked, or the extension is turned off.
- Because the service worker can restart, treat the tracking as best-effort. `revealPage()` already sets inline `visibility: visible !important` on `<html>`, which keeps the current page usable even if the stylesheet is still present.
- Handle permission revocation while an overlay is open. `chrome.permissions.onRemoved` currently only re-syncs registration (`background.js:138–140`); it does not message affected tabs. Send a reveal/cleanup message, or make the content script detect the loss.
- Make the re-injection guard invalid-context-aware. `interceptor.js:4` returns early whenever `__focusFriendInstance` is true. If the old instance is stale after the extension is re-enabled, the guard can block the fresh injection. Keep the guard’s purpose — never stack two live overlays — but allow a fresh instance to replace a stale one.
- Keep the CSS and JS lifecycle together. Do not create a path where CSS is present without a working interceptor.

**Done when:** an already-open tab is covered immediately; computed host style is `position: fixed` and full-viewport; disabling reveals the page; re-enabling works; reloading is clean; no orphaned hidden page; no duplicate overlays.

**Not in scope:** interception behavior, SPA support, or overlay design.

---

### REL-03 — Make the overlay actually modal for keyboard and screen-reader users

**Evidence:** `[code]` The panel is declared `role="dialog" aria-modal="true" aria-live="polite"` at `interceptor.js:1129`. There is no focus move, focus trap, focus restore, `inert`, or `aria-hidden` on the page behind it. The only deliberate focus calls are the vent textarea and the breathing start button. `[runtime]` A real site button remained in the accessibility tree behind the overlay. The dialog has no `lang` attribute; only the vent study sets one (`interceptor.js:1435,1573,1719`). `options.html:2` and `popup.html:2` start with `lang="bn"` and correct it only after JavaScript runs (`options.js:22`, `popup.js:6`).

**Why it blocks:** keyboard and screen-reader users can tab into and activate a page they cannot see. The `aria-modal` claim is false. Bangla and English content may be pronounced with the wrong voice. This is a public-release quality and inclusion blocker.

**Exact fix:**

- While a full-screen view is active, set `document.body.inert = true`. The host is appended to `document.documentElement` (`interceptor.js:1134`), so it remains interactive. Restore `inert = false` in `revealPage()`.
- Move focus into the dialog on each view change — the heading or the first action. Trap Tab and Shift+Tab within the shadow root. Restore focus to the previously focused element on dismissal.
- Add `aria-labelledby` to the dialog, pointing at the current heading. Remove `aria-live="polite"` from the whole dialog; use a single polite status line for view changes so the entire panel is not re-announced.
- Set `lang` and `dir` on the overlay host or panel from `settings.language` (`bn` or `en`). Bangla is LTR, but `lang` is still required for pronunciation.
- Fix the initial document language on the options and popup pages. Do not hardcode `lang="bn"`; set the correct language before first paint, or use a neutral default and correct it before content is announced.
- Do not add Escape dismissal or any new dismissal path. The existing “Not now” and other visible actions remain the exits.

**Done when:** the background is not reachable by Tab or screen-reader navigation while the overlay is open; focus enters, stays inside, and returns on dismissal; `lang` is correct; axe DevTools reports no serious or critical issues; the full loop is completable with a keyboard and with a screen reader.

**Not in scope:** check-in behavior, breathing behavior, or visual redesign.

---

### REL-04 — Fail open when the content script cannot start

**Evidence:** `[code]` `interceptor.css:2–4` hides the page with `html { visibility: hidden !important; }`. The only reliable reveal is `revealPage()` (`interceptor.js:40–74`) or `mountCover()` setting the page visible at `interceptor.js:1137`. If the content script is blocked, throws before that point, or cannot load its copy, the page can remain hidden indefinitely. `[unverified]` This was not reproduced in the smoke test.

**Why it blocks:** a hidden page is the worst failure mode. The user cannot use the site, cannot see an error, and may not know the extension caused it.

**Exact fix:**

- Add a CSS-only fail-safe that makes the page visible after a short timeout (for example, 8 seconds) even if JavaScript never runs. It must win in the cascade against the hide rule; if the current `!important` rule prevents that, change the hide/reveal mechanism so a delayed rule can override it. Test the exact cascade in Chrome.
- Add a JavaScript watchdog as a second layer: if startup has not mounted a real view within the timeout, call `revealPage()`.
- Wrap `start()`, `mountCover()`, and the remaining async startup paths in `try/catch`. On any error, reveal the page and log a concise diagnostic.
- Test with: JavaScript disabled for the site, a deliberately thrown startup error, a missing/corrupt content JSON, a storage failure, a cold service worker, blocked content-script injection, the extension disabled while the overlay is open, and host permission revoked while the overlay is open.
- Do not rely on `beforeunload` or `visibilitychange` for the fail-safe; they do not run when the page is hidden by CSS.

**Done when:** each simulated failure leaves the page usable within the timeout; the normal overlay path is unaffected; no single script error can leave a page hidden.

**Not in scope:** changing the normal overlay timing or design.

---

### REL-06 — Add a privacy policy and in-product disclosure

**Evidence:** `[code]` `store/` is empty. There is no privacy policy, no first-run disclosure, and no consent record. The extension stores settings and enabled domains in `chrome.storage.sync` and counters in `chrome.storage.local` (`storage.js`, `interceptor.js`). `manifest.json:7` declares broad optional host permissions (`http://*/*`, `https://*/*`).

**Why it blocks:** the Chrome Web Store requires a privacy policy and an accurate data-use disclosure. Missing or inaccurate disclosure is a common rejection reason. Users cannot make an informed choice about browsing-domain access.

**Exact fix:**

- Write and host a privacy policy at a stable public URL. Cover:
  - what is stored: settings, enabled domains, cooldown timestamps, daily “Not now” counts, active-time totals, vent round counts, voice history, and the last completed cycle count;
  - where it is stored: `chrome.storage.sync` for settings, `chrome.storage.local` for device-local counters;
  - why it is stored;
  - retention and deletion;
  - no transmission to the developer’s servers;
  - `chrome.storage.sync` may be synced by Chrome according to the user’s Chrome sync settings;
  - no analytics, no sale, no third-party sharing by the extension;
  - the Chrome Web Store Limited Use affirmative statement.
- Add a first-run disclosure before requesting host access. Explain in plain language that the extension reads the domains the user selects to show the pause, stores settings and counters locally, does not transmit browsing data, and does not sell it. Link the policy. Require an explicit action such as “I understand — choose sites” before the permission request. Store a consent version so a future policy change can re-disclose.
- Complete the store’s data-usage disclosure accurately. Do not claim “no data” when domains and counters are stored.
- Do not add analytics, accounts, or any new data collection.

**Done when:** the policy URL is live; the disclosure is shown before the permission request; the consent version is stored; the store disclosure matches the actual storage behavior.

**Status:** Policy written at `docs/privacy.html` and linked from the landing page at `docs/index.html`. The options page now shows a first-run disclosure before the settings or permission controls, requires “I understand — choose sites,” and stores `onboarding_consent_version: 1` plus a timestamp in `chrome.storage.local`. A stale consent version shows the disclosure again. **Remaining external action:** enable GitHub Pages so the URL is publicly live.

---

### REL-07 — Prepare the store listing and assets

**Evidence:** `[code]` `store/` is empty. There is no listing copy, screenshot, tile, marquee, support URL, or permission justification. `manifest.json:5` has only a one-line description.

**Why it blocks:** the store cannot be submitted without a listing, at least one screenshot, and permission justifications. Broad optional host permissions and well-being content increase review scrutiny.

**Exact fix:**

- Prepare the listing: final name, short description (≤132 characters), detailed description, category, language, support URL, homepage, and privacy policy URL.
- Prepare at least one screenshot at 1280×800 or 640×400 (up to five), a 440×280 tile, and a 1400×560 marquee. Use real UI, not mockups that differ from the product.
- Prepare permission justifications:
  - `storage` — save settings, language, and local counters.
  - `scripting` — register the pause content script and inject it into already-open tabs.
  - optional `http://*/*` and `https://*/*` — the user chooses arbitrary sites; access is requested only for the domains they enable.
- Review the optional host pattern scope against the minimum-permission policy. If `http://*/*` is not needed, remove it; if it is, explain why.
- State “no remote code.” All JavaScript and content JSON are packaged.
- Copy must match the locked behavior: 5-minute count-up breathing with “Do it again,” the current full-screen check-in, no SPA interception, and no medical or therapeutic claims.

**Done when:** every dashboard field is complete; assets meet the current dimensions; the copy matches the product; the justifications are specific and truthful.

**Status:** `store/listing.md` contains the final name, 114-character short description, detailed description, category, languages, URLs, single-purpose statement, permission justifications, data-use answers, screenshot order, and submission checklist. The data-use table follows current Chrome Web Store guidance: local storage still counts as handling user data, and the current hostname and per-domain counters count as “Web history.” The table answers Yes for Web history and User activity with precise limits, and the privacy policy now has matching “Browsing and activity information” language. `store/screenshots/` has five 1280×800 captures plus two alternates; `store/assets/` has the 440×280 tile and 1400×560 marquee. `store/README.md` documents the GitHub Pages setup and the capture command.

---

### REL-08 — Add a reproducible package and release version

**Evidence:** `[code]` The original build had no `package.json`, build script, or package output; `dist/` was empty. `icons/gen_icons.js:155` hardcoded `c:/Users/MY PC/Desktop/Focus/icons/`. The manifest version was `0.1.0`.

**Why it blocks:** a store upload needs a clean, reproducible ZIP containing only runtime files. Shipping dev files, absolute paths, or a missing file causes rejection or a broken install.

**Exact fix:**

- Add a dependency-free Node or PowerShell packaging script that copies an explicit allowlist into `dist/` and creates a ZIP.
- Include only:
  - `manifest.json`
  - `background.js`
  - `storage.js`
  - `interceptor.js`
  - `interceptor.css`
  - `popup.html`, `popup.css`, `popup.js`
  - `options.html`, `options.css`, `options.js`
  - `content/en.json`, `content/bn.json`
  - `icons/icon16.png`, `icons/icon32.png`, `icons/icon48.png`, `icons/icon128.png`
- Exclude `.git/`, `spike/`, `store/`, `docs/`, `scripts/`, `README.md`, `focus-friend-spec.md`, `focus-friend-learning-plan.md`, `icons/gen_icons.js`, `icons/icon.svg`, and any test artifacts.
- Replace the absolute path in `icons/gen_icons.js` with a path relative to the script, so the build is reproducible on another machine.
- Set the version to `1.0.2` and add release notes or a changelog.
- Validate that every path referenced by the manifest exists in the ZIP; validate JSON; verify icon dimensions; scan for remote script URLs and absolute local paths.
- Test the ZIP in a clean Chrome profile, not the development profile.

**Done when:** one command produces the same ZIP from a clean checkout; the ZIP installs and runs in a clean profile; the store accepts the upload; no dev-only file is present.

---

## 3. P1 issues

### REL-05 — Move hardcoded user-facing strings into the content banks

**Evidence:** `[code]` Bangla fallbacks are hardcoded in `interceptor.js` at `1278–1286` (check-in title, hint, and response) and `2732` (timer label). The active-time pill’s close button has a hardcoded English `aria-label="Close"` at `3044`. `options.html:2` and `popup.html:2` hardcode `lang="bn"` and correct it only after JavaScript runs.

**Why it matters:** a Bangla user hears “Close” in English; a damaged or missing copy file can show Bangla to an English user; translators cannot find the strings. The product claims bilingual support.

**Exact fix:**

- Add the missing keys to both `content/en.json` and `content/bn.json`.
- Replace the literals with `copy...` lookups. Keep only diagnostic logs in JavaScript.
- Fix the initial document language as part of REL-03.
- Do not rewrite existing copy or change the language picker.

**Done when:** a language switch changes every visible and announced string; no user-facing literal remains in JavaScript; both banks have the same keys.

**Not in scope:** copy tone, fact content, or new languages.

---

### REL-09 — Verify the return-to-work fallback

**Evidence:** `[code]` `background.js:146–159` navigates the current tab to `chrome://newtab/` with `chrome.tabs.update`. `[unverified]` Chrome may reject extension navigation to `chrome://` URLs. The failure UI exists (`interceptor.js:2822–2828`), but the success path has not been proven.

**Why it matters:** returning to work is the re-entry ritual. A broken fallback leaves the user on the pause screen or shows an error at the most important moment.

**Exact fix:**

- Test both cases: previous page is a safe work page, and direct load with no referrer.
- If `chrome://newtab/` is blocked, use a supported flow — for example, create a new tab, then close or navigate the current one — or change the promise and copy to match what Chrome allows.
- Keep the “Stay here” escape hatch and the existing failure UI.

**Done when:** both cases work in a clean profile; no error is shown on the happy path; the failure UI is reachable and recoverable.

**This is a verification item, not a confirmed bug.** If it fails, promote it to P0.

---

### REL-10 — Verify strict-CSP sites

**Evidence:** `[code]` The overlay injects a large inline `<style>` element into a shadow root (`interceptor.js:177–1127`). `[unverified]` Some sites’ Content Security Policy can block inline styles added to the page, even from a content script.

**Why it matters:** if the styles are blocked, the overlay is unstyled or invisible on high-value sites; if `interceptor.css` still hides `html`, the page can be unusable.

**Exact fix:**

- Test on GitHub, X, YouTube, Google, and a site with a strict `style-src`.
- If blocked, move the styles to a constructable stylesheet, an extension-hosted stylesheet with `web_accessible_resources`, or `chrome.scripting.insertCSS` as appropriate.
- Keep the fail-open behavior from REL-04.

**Done when:** the overlay renders correctly on the strict-CSP test set; no CSP errors in the console; the page is never left hidden.

**This is a verification item, not a confirmed bug.** If any default site fails, promote it to P0.

---

### REL-11 — Revoke host access when a site is removed or disabled

**Evidence:** `[code]` No code path calls `chrome.permissions.remove`. `options.js:107–111` removes a site from `sites` and `enabled_sites`, and `options.js:92–97` unchecks it, but the optional host permission remains granted. `background.js:138–140` only re-syncs registration when permissions change.

**Why it matters:** the extension retains access to sites it no longer pauses. That contradicts the “access only for the sites you choose” promise and the least-privilege expectation.

**Exact fix:**

- Decide the intended behavior:
  - **Revoke:** call `chrome.permissions.remove({ origins })` when a site is removed or disabled. Re-enabling will prompt for access again.
  - **Retain and document:** keep access for quick re-enable, and say so in the privacy policy and options copy.
- If revoking, handle the permission prompt on re-enable and make the status message accurate.
- Do not change the site list or pause behavior otherwise.

**Done when:** the chosen behavior is implemented or documented; the options page and privacy policy agree; no stale access remains without disclosure.

**Status:** Implemented. The per-site toggle requests access when turned on and calls `chrome.permissions.remove` when turned off; the remove button also revokes access. Re-enabling prompts again. Turning the whole extension off keeps access for configured sites so it can be resumed without re-approving each one; the options page and policy state this. The background already reveals and cleans up open tabs on `chrome.permissions.onRemoved`.

---

## 4. Verification gates

These are not confirmed bugs. They must pass before public submission.

| Gate | What to verify |
|---|---|
| Clean-profile ZIP install | The packaged ZIP loads with no missing files and no console errors. |
| Open-tab lifecycle | Enable, add a site, grant access, disable, re-enable, remove a site, revoke access — all with the tab already open. |
| Keyboard and screen reader | The full loop works without a mouse; the background is not reachable; focus returns. |
| Return-to-work | Both the previous-page path and the new-tab fallback work, or the failure UI is reachable and recoverable. |
| Strict-CSP sites | The overlay renders on GitHub, X, YouTube, Google, and a strict `style-src` site. |
| Failure modes | JS disabled, startup error, missing copy, storage failure, cold service worker, blocked injection, extension disabled while open, permission revoked while open. |
| Network audit | No extension-originated requests to remote servers; only packaged resources. Chrome Sync is disclosed separately. |
| Storage audit | No full URLs, page content, or vent text stored; keys match the privacy policy. |
| Store dashboard | Every required field, asset, justification, and disclosure is complete. |

### Verification log — 2026-11-24

Baseline tests ran against `1.0.0` in an isolated Chrome 158 profile. The extension copy used for overlay tests added only a test host permission and a read-only debug hook; the packaged ZIP was tested separately without either. Focus styling was verified in 1.0.1; vent keyboard isolation was verified in 1.0.2.

- **Baseline flow:** greeting, breathing prep, breathing timer, fact reveal, full-screen check-in after six “Not now” choices, and no auto-dismiss after 11 s.
- **Open-tab lifecycle:** enabling while a tab is already open inserts the CSS and JS; the host computes `position: fixed` and fills the viewport. Disabling and removing the site remove the host, restore the page, and clear the hide animation.
- **Modal behavior:** `body.inert` is true and `body[aria-hidden="true"]` while open; the real page button is absent from the accessibility tree; focus starts on “Let’s go,” cycles through the overlay actions, wraps with Tab/Shift+Tab, and returns to the previously focused page button on dismissal.
- **Language:** switching to Bangla updates the overlay `lang`, panel `lang`, focusable labels, and accessibility names; switching back restores English.
- **Re-injection:** a second injection replaces the old instance and leaves exactly one overlay host.
- **Fail-open:** a fresh page with no content script is hidden at 0.8 s after `interceptor.css` is injected, then visible after the 8 s animation; the animation is removed when the page is released.
- **Return-to-work:** a page opened from a work page returns to the work page; a direct load with no referrer navigates the tab to `chrome://newtab/`.
- **Strict CSP:** the overlay renders fully styled under `style-src 'self'` and `style-src 'none'`; the page’s own external stylesheet is blocked in the `none` case, but the shadow-DOM overlay is not.
- **Package:** the 1.0.0 ZIP contains exactly the 17 allowlisted runtime files; it loads in a clean profile with no install-time host permissions, no registered content scripts, and no service-worker exceptions; options and popup render with the new name and no old name.
- **First-run disclosure:** a fresh profile shows the disclosure with the settings content hidden; the language choice switches the disclosure between English and Bangla; “I understand — choose sites” stores `onboarding_consent_version: 1` and reveals the settings; a reload keeps it hidden; an older stored version shows it again.
- **Browser-language default:** a fresh `en-US` profile stores `language: "en"`; a fresh `bn` profile reports `navigator.language: "bn-IN"` and stores `language: "bn"`. Existing saved languages are preserved.
- **Host access lifecycle:** with Chrome permission calls stubbed to record arguments, turning `instagram.com` off called `remove` for both its `http` and `https` patterns and removed it from `enabled_sites`; turning it on called `request` and re-added it; the remove button called `remove` and deleted the row. `domainsFromOrigins` parsed `http://*.focus.test/*`, `https://*.focus.test/*`, and `https://x.com/*` to `focus.test` and `x.com`.
- **Adding a site:** permission request is made for only the new domain. Granting it adds the domain to `enabled_sites` and leaves its checkbox checked; declining keeps the domain in `sites` but off, with retry available through the toggle.
- **Store assets:** five real 1280×800 UI captures plus two alternates; 440×280 tile; 1400×560 marquee. The settings capture uses realistic domains and a granted state.
- **Public URLs:** `https://asef-mahir.github.io/intermission/` and `/privacy.html` return 200 with the new source and policy links; the old `focus-friend` Pages URLs return 404; the old GitHub repo URL redirects to `https://github.com/asef-mahir/intermission`; `release-readiness-plan.md` is not published (404).
- **Disclosure consistency:** the store table, detailed description, first-run copy, and privacy policy now agree that the extension reads the current hostname, stores per-domain counters, and counts active seconds, while not storing full URLs, page titles, page content, vent text, clicks, keystrokes, or an interaction timeline. `docs/_config.yml` excludes the internal release plan from GitHub Pages.
- **Focus styling fix:** text-only dialogs no longer show the browser's default outline; mouse-driven transitions no longer make the next primary button appear pressed; Tab/Shift+Tab still show the keyboard focus ring. The return path and focus-trap tests pass.
- **Vent keyboard isolation:** a synthetic host-page capture listener that prevents `j`, `k`, and `p` no longer sees keystrokes from the focused vent textarea; the textarea receives `jkp`, and the overlay's Tab focus trap remains active.
- **Active-time pill language:** with the bottom-right check-in visible, changing sync language from English to Bangla updates its title and buttons in place.
- **Add-site permissions:** stubbed grant and denial results confirm that Add requests only the new domain; a grant leaves the new row checked, while denial stores it off and displays localized retry guidance.

**Not yet tested:** the real Chrome host-permission bubble (headless Chrome blocks on the prompt, so the API calls were verified with stubs and the background cleanup path is shared with the tested disable/removal flow); real GitHub/X/YouTube/Google pages; a deliberately thrown startup error; storage failure; cold service worker; blocked content-script injection; host permission revoked while the overlay is open. The CSS fail-open and permission-revocation cleanup are the intended safety nets for those cases.

---

## 5. Decisions needed

| # | Decision | Options | Recommendation | Blocks |
|---|---|---|---|---|
| D1 | Final product name | **Decided: Intermission** | Applied to the manifest, popup, options, language banks, README, and package. Use the same name in the store listing and privacy policy. | Done |
| D2 | Fact content | **Decided: facts are checked** | All 175 items in both banks were confirmed checked; the `needs_verify` flags were removed. No copy rewrite. | Done |
| D3 | Default language | **Decided: browser language** | New installs follow the browser UI language, fall back to English, and see an explicit language choice in the first-run disclosure. Existing saved choices are preserved. | Done |
| D4 | Privacy policy host | **Decided: GitHub Pages** | Policy is at `docs/privacy.html`; enable Pages from `main` / `docs` to publish `https://asef-mahir.github.io/intermission/privacy.html`. | REL-06, REL-07 |
| D5 | Incognito | **Decided: not supported** | Documented in the README, listing, and policy. | Done |
| D6 | Host access after site removal | **Decided: revoke** | Per-site off and remove call `chrome.permissions.remove`; re-enabling requests access again. Global off is documented separately. | Done |

**Note on D2:** both content banks contained 175 fact items marked `"needs_verify": true`. The user confirmed they are fact-checked, so the flags were removed from both banks. This is a content decision, not a code change to the facts themselves.

---

## 6. Locked behavior — no action

These items were in the previous plan and are now explicitly closed. They are not bugs for this release.

### Breathing

- **Current behavior:** 5 minutes (`BREATH_MAX_MS = 300_000`, `interceptor.js:11`), count-up timer (`timeElapsed`, `interceptor.js:2728–2733`), and “Do it again” on the completion screen (`content/en.json:65–68`).
- **Decision:** keep it exactly as it is. No code change.
- **Doc/store action:** describe the 5-minute count-up flow and “Do it again” in the README and store listing. The internal spec’s 60-second/countdown section is obsolete for this release; update only that section if the spec is still used.

### Full-screen check-in

- **Current behavior:** after repeated “Not now” choices, a full-screen panel asks whether to keep the pause or turn it off for the site. It does not auto-dismiss.
- **Decision:** keep it as it is. No code change.
- **Copy note:** the settings copy says “ask once” (`content/en.json:24–25`), while the implementation can ask again every sixth choice (`interceptor.js:2617–2618`). This is a text inconsistency, not a behavior change. I am not changing either without your say-so. If you want the copy to match, it is a one-line text change.

### SPA navigation

- **Current behavior:** the interceptor runs at `document_start` and re-checks on `visibilitychange` (`interceptor.js:3213–3222`), but it does not patch `pushState`, `replaceState`, or `popstate`.
- **Decision:** no SPA interception. The pause runs on full page loads and refreshes only.
- **Doc action:** state this limitation in the README and, if useful, the store listing. No code change.

### Feature redesigns

- No redesign of the greeting, breathing, fact reveal, vent room, check-in, or active-time pill.
- No new features, no new permissions, no analytics, no accounts.

---

## 7. Removed from the previous plan

For clarity, these earlier proposals are withdrawn:

- The check-in toast redesign and 10-second auto-dismiss.
- The 60-second countdown and removal of “Do it again.”
- SPA route interception.
- The full fact-bank rewrite and swerve redesign.
- The `interceptor.js` refactor.
- The unlisted-beta requirement (still recommended, but not an issue).
- Incognito support (moved to D5).

---

## 8. Approval

The approved runtime work is implemented:

- **REL-01** renamed to Intermission (D1 decided).
- **REL-02** open-tab CSS injection and cleanup.
- **REL-03** modal isolation, focus management, and language metadata.
- **REL-04** CSS and JavaScript fail-open protection.
- **REL-05** hardcoded strings moved into the language banks.
- **REL-08** packaging script, version `1.0.2`, and clean-profile ZIP test.
- **REL-09** return-to-work paths verified.
- **REL-10** synthetic strict-CSP rendering verified.

All decisions are resolved:

- **D2** facts are checked; the `needs_verify` flags were removed.
- **D3** browser language with an explicit first-run choice; implemented.
- **D4** GitHub Pages; live at `https://asef-mahir.github.io/intermission/`.
- **D5** incognito not supported; documented.
- **D6** host access is revoked on per-site off/remove; implemented.
- **REL-06**, **REL-07**, and **REL-11** are implemented.

GitHub Releases provides versioned manual-install packages; `dist/` remains gitignored and ZIPs are attached to releases rather than committed into the source tree. The published v1.0.1 package is 303,038 bytes, contains 17 runtime files, and has SHA-256 `C0FBB5430D8CF7720D9256E71B059E8F0C97C61E415637A622E88F81CA39A72A`. The v1.0.2 candidate includes vent keyboard isolation, the clearer add-site permission flow, and live language updates for the active-time check-in; it builds to 306,107 bytes (17 runtime files; SHA-256 `F7FA117534E7D6A192313F0F9479BC8521BE418B8B3350DDAAE6A4C21DF74B06`).

Current distribution plan:

1. Users obtain the current manual-install package through GitHub Releases. They still need to use **Load unpacked**, and updates are manual.
2. The Chrome Web Store submission is paused. Revisit it later if the owner decides the developer registration fee is worthwhile; no store submission has been made.
3. Real-site spot checks (GitHub, X, YouTube, Google) remain optional before a future store submission.

The locked behavior in section 6 remains unchanged.

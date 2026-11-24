# Chrome Web Store listing — Intermission 1.0.0

Use this file to fill the Chrome Web Store dashboard. Copy is final unless a fact changes.

## Basics

| Field | Value |
|---|---|
| Name | Intermission |
| Short description | Show a short pause before the sites you choose. Breathe, read something odd, and get back to what you meant to do. |
| Category | Productivity (alternative: Health & Fitness) |
| Languages | English, Bengali (বাংলা) |
| Homepage | https://asef-mahir.github.io/focus-friend/ |
| Support | https://github.com/asef-mahir/focus-friend/issues |
| Privacy policy | https://asef-mahir.github.io/focus-friend/privacy.html |
| Incognito | Not supported in 1.0 |
| Remote code | No. All JavaScript and copy are packaged. |

Short description length: 114 characters (limit 132).

## Detailed description

```
Intermission is a small Chrome extension for the sites where you lose time.

When you open or refresh a site you chose, Intermission covers the page with a short pause. You can take a breath, read a fact, or vent for a moment. Then you get a clear way back to what you were doing.

WHAT IT DOES
• Shows a pause on full page loads of the sites you choose.
• Offers optional five-minute breathing with a count-up timer and “Do it again.”
• Shares a fact and a quiet way back to work.
• Offers a full-screen check-in after repeated “Not now” choices.
• Offers an optional gentle check-in after continuous use.
• Supports English and Bangla.

WHAT IT DOESN'T DO
• No accounts, analytics, ads, or developer servers.
• No page content, vent text, or list of visited pages is stored or sent. It reads the current hostname only to match your chosen sites.
• No SPA or in-page navigation interception. The pause runs on full page loads and refreshes only.
• Not a medical or therapeutic service.

PRIVACY
Intermission stores your settings in Chrome storage and keeps small counters on your device. It asks for access only to the sites you turn on. Removing or turning off a site gives that access back. Read the full policy at https://asef-mahir.github.io/focus-friend/privacy.html.

PERMISSIONS
• storage — save settings and counters.
• scripting — register the pause and inject it into tabs that are already open.
• optional host access — show the pause only on the sites you choose.

LANGUAGES
English and বাংলা (Bangla).

A NOTE ON BREATHING
The breathing screen runs for five minutes and counts up. You can stop whenever you like and return to the page.
```

## Single purpose

Intermission shows a short pause before full page loads of websites the user chooses, then offers a way back to the page.

## Permission justifications

### `storage`

Stores the user's chosen sites, language, pause frequency, and check-in preferences in `chrome.storage.sync`, plus small device-local counters in `chrome.storage.local` (last pause time per site, daily “Not now” counts, daily active-time totals, vent rounds, voice history, and the last breathing cycle count). The chosen domains and per-domain counters are stored; page content, vent text, full URLs, and page titles are not.

### `scripting`

Registers the pause content script for the user's enabled domains and injects it into tabs that are already open when the user enables a site or grants access. The script renders the pause overlay and is removed when the site is disabled or removed.

### Optional host permissions (`http://*/*`, `https://*/*`)

The user can add any website to a personal pause list. Access is requested only for the domains the user turns on, at the moment they turn them on. No host access is granted at install time. Access is revoked when a site is removed or turned off; turning it back on asks again. The extension does not read page content and only compares the current hostname with the user's chosen list.

## Data usage disclosure

The Chrome Web Store counts locally stored data as handling user data, and it treats domains as browsing activity. Answer the dashboard as follows. Each explanation is also reflected in `docs/privacy.html`.

| Dashboard field | Selection | Explanation to use |
|---|---|---|
| Does the extension collect or use user data? | **Yes** | It stores settings and small per-site counters in Chrome storage for its single purpose. Nothing is sent to the developer. |
| Personally identifiable information | No | No names, email addresses, account IDs, or other identifiers. |
| Health information | No | No health data. Breathing is an optional UI feature, not a health service. |
| Financial and payment information | No | No payments or financial data. |
| Authentication information | No | No logins, passwords, or authentication cookies. |
| Personal communications | No | No messages, email, or chat content. Vent text is never saved or sent. |
| Location | No | No location data. |
| Web history | **Yes** | It reads the current hostname only to match the user's chosen site list. It stores per-site counters: last pause time, daily “Not now” counts, and daily active seconds. It does not store full URLs, page titles, query strings, or a list of visited pages. |
| User activity | **Yes** | It counts active seconds on chosen sites for the optional active-time check-in, plus daily “Not now” and vent-round counts. It does not log clicks, keystrokes, mouse positions, or an interaction timeline. |
| Website content | No | Page content is never read, stored, or sent. |
| I do not sell or transfer user data to third parties, outside of approved use cases. | **Certify** | No sale, rent, or third-party transfer. Chrome sync is part of Chrome, not a developer transfer. |
| I do not use or transfer user data for purposes unrelated to the item's single purpose. | **Certify** | Data is used only to run the pause, cooldowns, check-ins, and preferences. |
| I do not use or transfer user data to determine creditworthiness or for lending. | **Certify** | No such use. |

Also certify the Limited Use statement. The privacy policy repeats it.

## Assets

| Asset | File | Size |
|---|---|---|
| Screenshot 1 — greeting | `store/screenshots/01-greeting.png` | 1280×800 |
| Screenshot 2 — breathing ready | `store/screenshots/02-breathing-ready.png` | 1280×800 |
| Screenshot 3 — breathing timer | `store/screenshots/03-breathing.png` | 1280×800 |
| Screenshot 4 — fact reveal | `store/screenshots/04-fact.png` | 1280×800 |
| Screenshot 5 — check-in | `store/screenshots/05-checkin.png` | 1280×800 |
| Alternate — first-run disclosure | `store/screenshots/06-first-run.png` | 1280×800 |
| Alternate — settings | `store/screenshots/07-settings.png` | 1280×800 |
| Small promo tile | `store/assets/tile-440x280.png` | 440×280 |
| Marquee | `store/assets/marquee-1400x560.png` | 1400×560 |
| Store icon | `icons/icon128.png` | 128×128 |

Recommended order: greeting, breathing timer, fact, check-in, first-run disclosure. The settings screenshot is a good substitute if the dashboard prefers a configuration view.

## Screenshot captions (optional)

1. A short pause before the sites you choose.
2. Five minutes of breathing, with a count-up timer.
3. A fact, then a clear way back.
4. A full-screen check-in after repeated “Not now” choices.
5. A plain-language privacy disclosure before any site access.

## Submission checklist

1. Enable GitHub Pages for `asef-mahir/focus-friend` from the `main` branch, `/docs` folder.
2. Confirm these URLs load:
   - https://asef-mahir.github.io/focus-friend/
   - https://asef-mahir.github.io/focus-friend/privacy.html
3. Run `node scripts/build.js` and confirm the ZIP is `dist/intermission-1.0.0.zip`.
4. Upload the ZIP in the Chrome Web Store developer dashboard.
5. Paste the short and detailed descriptions, category, languages, and URLs.
6. Upload the five screenshots, tile, and marquee.
7. Complete the privacy practices tab with the table above and the policy URL.
8. Add the permission justifications exactly as written.
9. Set incognito to “Not supported” and add the note if the dashboard asks.
10. Submit for review. Do not add analytics, accounts, or new permissions during review.

## Notes for review

- The package is Manifest V3 and uses no remote code.
- Host access is optional and requested at runtime. There are no `host_permissions` in the manifest.
- The extension has no server component and makes no network requests.
- The only user-facing name is “Intermission.” Internal content-script IDs retain `focus-friend-*` for migration safety and are not visible to users.
- The breathing timer is five minutes and counts up by design. It is not a medical or therapeutic feature.

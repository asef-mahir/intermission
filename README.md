# Intermission

A small Chrome extension that offers a short intermission before the sites you choose.

## What it does

- Shows a full-screen pause on full page loads and refreshes of enabled sites.
- Offers a greeting, optional breathing, a fact reveal, and a way back to work.
- Keeps the existing full-screen check-in after repeated “Not now” choices.
- Offers an optional active-time check-in after continuous use.
- Supports English and Bangla copy, defaulting to the browser language on a new install.
- Shows a first-run disclosure before any site access and remembers the consent version.
- Uses no accounts, analytics, remote code, or developer servers.

## Locked behavior

- **Breathing:** 5 minutes, count-up timer, and “Do it again.”
- **Check-in:** the current full-screen check-in is unchanged.
- **Navigation:** full page loads and refreshes only. SPA/in-page navigation is not intercepted.

## Install for development

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this folder (or `dist/unpacked`).
3. Open the options page, choose your sites, and allow access for those sites.

The extension requests host access only for the domains you enable. No host access is granted at install time. Turning a site off or removing it revokes that site's access; turning it back on asks again.

## Build

```powershell
node scripts/build.js
```

This validates the runtime allowlist and writes:

- `dist/unpacked/` — a clean unpacked build.
- `dist/intermission-1.0.0.zip` — the Chrome Web Store upload.

Validate without writing:

```powershell
node scripts/build.js --check
```

The build script checks manifest references, JSON, icon dimensions, content-bank key parity, remote-code patterns, absolute local paths, and the ZIP contents. It has no npm dependencies.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Save settings, language, enabled domains, and local counters. |
| `scripting` | Register the pause content script and inject it into already-open tabs. |
| Optional `http://*/*`, `https://*/*` | The user chooses arbitrary sites; access is requested only for enabled domains. |

## Privacy

- Settings and enabled domains are stored in `chrome.storage.sync`; Chrome may sync them according to the user’s Chrome sync settings.
- Cooldowns, daily counters, voice history, active-time totals, and the consent version are stored in `chrome.storage.local`.
- Page content and vent text are not stored or transmitted.
- The extension does not send browsing data to the developer, use analytics, or sell data.
- The full policy is at <https://asef-mahir.github.io/intermission/privacy.html>. The options page shows the disclosure before any site access and stores `onboarding_consent_version` in local storage.
- Incognito is not supported in `1.0`.

## Known limitations

- SPA/in-page navigation is not intercepted.
- Chrome internal pages and the Chrome Web Store cannot be paused.
- If host access is revoked while a pause is open, cleanup is best-effort; the 8-second CSS fail-open reveals the page.
- Turning the whole extension off keeps access for the configured sites so it can be resumed without re-approving each site. Removing or turning off a site does revoke that site's access.
- Real-site strict-CSP spot checks (GitHub, X, YouTube, Google) are still recommended before submission.

## Project layout

| Path | Purpose |
|---|---|
| `manifest.json` | Manifest V3 entry point. |
| `background.js` | Content-script registration, open-tab injection, cleanup, copy loading. |
| `storage.js` | Settings defaults, normalization, and domain parsing. |
| `interceptor.js` | Overlay, greeting, breathing, fact reveal, vent room, check-ins. |
| `interceptor.css` | Declarative page hide and CSS-only fail-open. |
| `popup.html`, `options.html` | Extension popup and settings page. |
| `content/en.json`, `content/bn.json` | User-facing copy. |
| `scripts/build.js` | Dependency-free packaging and validation. |
| `docs/privacy.html`, `docs/index.html` | Public policy and landing page for GitHub Pages. |
| `store/listing.md` | Store copy, justifications, and submission checklist. |
| `store/screenshots/`, `store/assets/` | Store images. |
| `docs/release-readiness-plan.md` | Release issues, decisions, and verification log. |
| `CHANGELOG.md` | Release notes. |

## Verification

The current `1.0.0` build was tested in an isolated Chrome profile for the greeting, breathing, fact reveal, check-in, open-tab injection, focus trap/restore, language switching, disable/removal cleanup, fail-open timing, return-to-work paths, strict-CSP rendering, first-run disclosure, browser-language default, per-site access revocation, and clean-profile ZIP install. See `docs/release-readiness-plan.md` for the detailed log.

# Changelog

## 1.0.2 — 2026-11-25

Keep site-level keyboard shortcuts from interfering with the vent writing area.

- Isolate keyboard events from the vent textarea so host-page shortcuts cannot cancel typed characters.
- Preserve text entry, active-time tracking, and Tab-based overlay focus navigation.
- Request access when a site is added; leave it unchecked if access is declined and show which selected sites still need access.
- Update an already-visible active-time check-in when the extension language changes.

## 1.0.1 — 2026-11-25

Refine focus styling for mouse and keyboard navigation.

- Keep the dialog's programmatic focus visually quiet on text-only transition screens.
- Avoid showing a keyboard focus ring after mouse-driven screen changes.
- Retain a clear focus ring when the user navigates the overlay with Tab or Shift+Tab.
- Preserve native Enter/Space activation and the existing focus trap and restoration behavior.

## 1.0.0 — 2026-11-24

Initial `1.0.0` package prepared as **Intermission**. The Chrome Web Store listing is not published yet.

- Renamed all user-facing “Focus Friend” references to “Intermission.”
- Added a short intermission description and bumped the manifest to `1.0.0`.
- Injected `interceptor.css` into already-open tabs when the extension or a site is enabled.
- Removed injected CSS and revealed open tabs when the extension or a site is disabled or removed.
- Made the pause dialog modal for keyboard and screen-reader users: page `inert`, focus trap, focus restore, and `aria-labelledby`.
- Added `lang` metadata to the overlay and corrected the initial options/popup document language.
- Added a CSS-only fail-open animation and a JavaScript startup watchdog so a failed content script cannot leave a page hidden.
- Moved the remaining user-facing check-in and timer strings into both language banks.
- Added a dependency-free packaging script and runtime-file validation.
- Added a first-run privacy disclosure with a stored consent version before any site access.
- New installs now follow the browser language, falling back to English; the first-run screen includes an explicit language choice.
- Turning a site off or removing it now revokes that site's host access; re-enabling asks again.
- Removed the internal `needs_verify` flags after the fact banks were confirmed checked.
- Added the public privacy policy page, store listing copy, screenshots, tile, and marquee.
- Documented that incognito is not supported in `1.0`.
- Kept breathing, the full-screen check-in, and full-page-load interception unchanged.

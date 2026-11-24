# Store assets and hosting

## What is here

| Path | Purpose |
|---|---|
| `listing.md` | Store copy, permission justifications, data-use answers, and submission checklist. |
| `screenshots/` | Real UI captures at 1280×800. |
| `assets/tile-440x280.png` | Small promo tile. |
| `assets/marquee-1400x560.png` | Marquee image. |
| `capture/capture.js` | Rebuilds the screenshots, tile, and marquee from the real extension. |

## Rebuild the images

```powershell
node store/capture/capture.js
```

The script creates a temporary extension copy with test host permissions, renders the real overlay in headless Chrome, and writes the PNGs. It does not touch the packaged runtime. The temporary profile and extension copy live in `store/capture/.tmp/` and are ignored by git.

## Host the privacy policy on GitHub Pages

The policy is a static page at `docs/privacy.html`. The repository already has a landing page at `docs/index.html`.

1. Push the repository to GitHub.
2. Open the repository's **Settings → Pages**.
3. Set **Source** to **Deploy from a branch**.
4. Choose the `main` branch and the `/docs` folder.
5. Save. The URLs become:
   - `https://asef-mahir.github.io/intermission/`
   - `https://asef-mahir.github.io/intermission/privacy.html`

If the repository is private, GitHub Pages requires a plan that supports private Pages, or the repository must be public. The store review needs the policy URL to be publicly reachable without a login.

If the repository or account changes, update `PRIVACY_URL` in `options.js`, the two links in `options.html`, and the URLs in `listing.md` and `docs/index.html`.

## Store icon

The store uses the 128×128 icon from the manifest. If the dashboard asks for a separate file, upload `icons/icon128.png`.

## Screenshot rules

- Use the real UI. The captures come from the packaged extension.
- Do not add device frames, marketing copy over the UI, or fake features.
- Keep the 1280×800 size. The store also accepts 640×400.
- Up to five screenshots are shown. The recommended five are listed in `listing.md`.

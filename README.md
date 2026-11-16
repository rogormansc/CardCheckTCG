# CardCheck TCG

A mobile-friendly card scanner and collection prototype. Runs as a static web app on iPhone Safari, Replit, GitHub Pages, or your computer. No paid AI API, Apple developer membership, runtime packages, or account system is required.

## Start here

Open this folder in VS Code. With Node.js 18 or later:

```bash
npm run setup
npm start
```

Open **http://localhost:4173** on the computer. There is no `npm install` step for running the app. `setup` downloads the card reference images; it does not train a neural network. If downloads are blocked, use **My catalog → Add reference** to supply your own clear photos. The app also attempts the catalog's public image source when a bundled reference is missing.

**For your iPhone:** upload the project contents to a public GitHub repository, enable **Settings → Pages → Deploy from a branch → main → / (root)**, and open the resulting HTTPS address in Safari. Use **Share → Add to Home Screen** for app-like access. GitHub Pages serves the static app; `server.mjs` is only needed for local/Replit development.

See **[SETUP.md](SETUP.md)** for complete VS Code, GitHub Pages, Replit, and iPhone instructions, adding cards, troubleshooting, and sources.

## What works

- Camera capture with rear-camera preference and a guide aligned with the captured crop.
- Photo uploads, local visual feature matching, geometric verification, and uncertain/unknown handling.
- Manual confirmation of the artwork, printed number, variant, and condition.
- Clearly labeled fictional price comparisons and external marketplace search links.
- Local collection storage, quantity controls, removal, sample totals, and CSV export.
- Eight-card catalog, up to four extra reference photos per card, and JSON backup/import.
- Relative URLs for GitHub Pages subpaths, service worker caching, and Home Screen manifest.
- Local image processing; no scan-upload endpoint, analytics, API keys, payments, or cloud database.

## Starting catalog

| Card | Printing |
| --- | --- |
| Umbreon V | Evolving Skies 189/203, Alternate Full Art |
| Gardevoir & Sylveon-GX | Unbroken Bonds 205/214, Alternate Full Art, 2019 |

“2025” in the request is interpreted as **205/214**. The catalog also offers a switch to the regular Full Art **204/214**. Only two cards are active initially, leaving six slots.

## Recognition and limitations

The app builds a local reference index from image features at launch. It uses FAST-style corners, rotated binary descriptors, and geometric verification. This fits a small known catalog and has no inference service fees. It is **not a pretrained neural network**. The match-strength score is not an accuracy percentage or a probability.

**Reference artwork could not be downloaded in the restricted build environment, so the archive contains source URLs and a validated downloader, rather than bundled card images or a prebuilt index.** Run setup on your normal network or add your own reference photos. A ready count of **2 / 2 cards ready** confirms that both references were indexed. Do this before your presentation.

Prices are fictional USD examples. Condition is user-selected; there is no automatic grading or authentication. Exact print editions, similar artwork, glare, sleeves, blur, and steep angles need physical-card testing. Camera access requires HTTPS or computer localhost. Offline use needs an initial successful online visit and cached/bundled references; test it on the actual phone before the presentation. Browser storage can be cleared by the user or system, so export a backup.

## Files to edit

| File | Purpose |
| --- | --- |
| `index.html`, `styles.css` | Interface and responsive design |
| `js/app.js` | Camera, catalog, collection, import/export, interaction logic |
| `js/recognizer.js` | Feature extraction, matching, geometric verification |
| `js/storage.js` | IndexedDB persistence |
| `data/cards.json` | Card metadata, reference paths, fictional prices |
| `tools/download-references.mjs` | Download and validate starter PNGs |
| `sw.js`, `manifest.webmanifest` | Offline asset caching and Home Screen metadata |
| `SETUP.md` | Deployment, expansion, constraints, and sources |

## Verification

JavaScript syntax checks and deterministic synthetic recognition checks run during development. The synthetic checks exercise transformation tolerance, unfamiliar/blank rejection, ambiguous artwork, multiple references, and model export/import. State tests cover catalog expansion and collection/backup behavior. The optional browser suite is included for execution on your computer.

```bash
node tests/state.mjs
node tests/offline.mjs
# Optional development-only dependency; the app itself needs no packages:
npm install --no-save @napi-rs/canvas
node tests/recognition.mjs
# Optional browser suite (run npm start in a second terminal):
npm install --no-save playwright
npx playwright install chromium
node tests/browser.mjs
```

Physical cards and iPhone camera behavior have not been validated in this build environment. The included browser smoke suite could not run here because Chromium startup was blocked. Do not report synthetic checks or reference-image self-matches as measured real-world accuracy.

## Code license

Original application code: MIT, see `LICENSE`. Card artwork and Pokémon names remain the property of their respective rights holders. The code license does not grant artwork reuse rights. Reference provenance is in `assets/cards/SOURCES.md`.

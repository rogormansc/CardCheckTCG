# CardCheck: setup and implementation

CardCheck is a small, mobile-friendly web app for a classroom demonstration. It identifies a limited catalog of trading-card artwork, displays clearly labeled example price comparisons, and keeps a collection on the device. It has no paid AI API, account system, or required backend database.

## Choose a workflow

| Tool you already have | Best use | How to run this project |
| --- | --- | --- |
| **VS Code** | Edit and test on your computer | Open this folder, then run `npm start` in the terminal |
| **GitHub + GitHub Pages** | Host the classroom demo for your iPhone | Put the project files in a public repository and enable Pages from `main`, `/ (root)` |
| **Replit** | Edit in a browser and preview quickly | Import the GitHub repository or ZIP, then use `npm start` as the Run command |

**Recommended:** edit in VS Code or Replit, keep the project on GitHub, and use GitHub Pages for the phone demonstration. The app consists of static files, so GitHub Pages does not need to run Node or a build step. `server.mjs` is only a development convenience.

## The two starting cards

| Catalog ID | Exact printing | Initial state |
| --- | --- | --- |
| `swsh7-189` | Umbreon V — Evolving Skies, **189/203**, Alternate Full Art, 2021 | Enabled |
| `sm10-205` | Gardevoir & Sylveon-GX — Unbroken Bonds, **205/214**, Alternate Full Art, 2019 | Enabled |
| `sm10-204` | Gardevoir & Sylveon-GX — Unbroken Bonds, **204/214**, Full Art, 2019 | Optional alternate printing |

The request's “Gardevoir & Sylveon GX (2025)” has been interpreted as **205/214**. That card is from 2019. If your physical card says **204/214**, use the optional Full Art printing instead. Match the number printed on the bottom of your card before testing. The app's catalog is intentionally small; roughly six additional cards can be added without changing the recognition approach.

## 1. Run in VS Code

1. Unzip the download and open the **`cardcheck` folder containing `index.html` and `package.json`** in VS Code.
2. Install a current Node.js LTS release if Node is not already available. In VS Code, open **Terminal → New Terminal**.
3. Save the reference artwork locally, then start the development server:

   ```bash
   npm run setup
   npm start
   ```

4. Open **http://localhost:4173** in your computer's browser. No `npm install` is required: the development server uses Node's built-in modules.
5. Allow camera access when you choose to start the camera. Alternatively, choose a JPG or PNG photo from your computer. Wait until the app shows both references are indexed before scanning.
6. Stop the server with **Ctrl+C** when finished.

Do not double-click `index.html` to launch the app. ES modules, `fetch`, and the offline worker expect an HTTP server. `localhost` refers to the device you are using: typing `localhost:4173` on your iPhone does not connect to your computer.

`npm run setup` uses Node's built-in `fetch` to download three verified PNG sources, including the optional Gardevoir printing. It does not train a neural network. Direct artwork downloads were blocked by this build environment's network filter, so reference PNGs are not bundled in this download. On your normal network the setup command should save them; the app also attempts the catalog's remote source when a local reference is missing. That fallback requires an internet connection and source-server CORS support. If either route is blocked, open the source link listed in `assets/cards/SOURCES.md`, save the PNG to the listed local path, or add your own reference photograph in Catalog. The app reports unavailable references instead of pretending they are ready. Run setup and index all references before relying on offline use.

## 2. Host on GitHub Pages for iPhone

1. Create a new **public** GitHub repository, for example `cardcheck`. GitHub Free supports Pages in public repositories. Do not put passwords, private photos, or API secrets in the repository.
2. Run `npm run setup` locally first, then upload the **contents** of the `cardcheck` folder so `index.html`, `package.json`, `js`, `data`, and `assets` are at the repository root. Include the downloaded `assets/cards/*.png`, `.nojekyll`, and the other supplied project files if using Git. Without local references, the hosted app will try its remote source fallback and need an initial internet connection.
3. Open the repository's **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**. Select **`main`** and **`/ (root)`**, then save.
5. Wait for deployment to finish and open the exact HTTPS address GitHub displays, normally **`https://YOUR-USERNAME.github.io/cardcheck/`**. Publishing can take several minutes.
6. Open that address directly in **Safari on your iPhone**, then allow camera access. Keep the trailing repository path; the app uses relative asset paths so project Pages URLs work.
7. For an app-like shortcut, use Safari's **Share → Add to Home Screen**. Depending on iOS, choose **Open as Web App** if that option appears.

HTTPS is essential for the live camera and service worker. An address such as `http://192.168.1.20:4173` may show the interface on your phone but is not a secure context for camera access. Use the GitHub HTTPS address for the simplest phone test. No Apple Developer Program membership or App Store submission is needed for this web app.

To update the hosted app, commit and push the changed files to the publishing branch. If you change the offline cache's asset list or release new code, update the cache version in `sw.js` as described in that file. Close and reopen the app after the updated worker activates; refresh the page while online if an older interface persists.

## 3. Run in Replit

1. Open [Replit Import](https://replit.com/import) and import the GitHub repository, or select ZIP import and upload the project archive. You can also create an empty Node.js project and upload the files.
2. Confirm that `index.html` and `package.json` are in the project root. Keep the supplied `.replit` configuration where supported.
3. In Replit's Shell, run **`npm run setup`** once to save the reference images. Set the Run command to **`npm start`**, then run the project. The supplied server binds to `0.0.0.0` and uses the `PORT` environment variable when Replit supplies one, falling back to port `4173`.
4. Open the preview in a **new browser tab**. Embedded previews may block camera permissions. For a phone demo, use the publicly accessible HTTPS address Replit supplies, rather than a workspace-only editor URL.
5. If you choose to publish through Replit, this app fits **Static** publishing: serve the project root and use no build command. If Replit requires a build command, a no-op such as `node -e "console.log('Static app ready')"` is sufficient. Do not choose a paid server just to host these static files.

Replit's free offering has limits. As checked on **15 November 2026**, its Starter documentation lists one free published app whose public link automatically goes down after 30 days, plus capped cloud credits. Review the limits shown in your own account before publishing; editing, AI assistance, and publishing are separate services. GitHub Pages is the recommended route if you need a stable classroom URL without using Replit publishing credits.

## Recognition, “training,” and six more cards

This prototype uses **reference-based computer vision**. It extracts distinctive visual features from each catalog card, then checks that features in a new photo line up geometrically. This is the reference-training step. It does **not** train a new neural network or learn the entire Pokémon catalog. A small, known set of two to eight cards is a good fit for this approach because it can run locally without an AI subscription.

The app must have usable reference images before a card is ready to scan. Check the catalog/model status before your presentation. If a bundled reference is unavailable, add a clear photo of that exact card using the catalog's reference controls; a clean, front-facing image with all four corners visible works best.

### Add cards using the interface

Use the catalog's add-card controls to enter the name, set, printed number, and variant, then attach a clear front image. Add extra reference photos with slightly different lighting or sleeve conditions where supported. Let indexing finish before scanning. Local additions remain in that browser's storage; they are not automatically published to GitHub or synchronized with your teammates. Export the catalog/training pack to back it up and import it on another device.

### Add cards permanently in the source

1. Put the reference image in `assets/cards/`, for example `assets/cards/new-card.jpg`. Use a clear image of the exact printing.
2. Add an entry to the `cards` array in `data/cards.json`:

   ```json
   {
     "id": "unique-card-id",
     "name": "Card name",
     "set": "Set name",
     "number": "123/456",
     "variant": "Exact artwork or printing",
     "year": 2026,
     "image": "assets/cards/new-card.jpg",
     "demoPrices": [20, 22, 19]
   }
   ```

3. Use a unique `id`; keep the JSON valid, including commas between entries. Do not copy the three sample price values into a real pricing claim. They are fictional USD examples for showing how comparisons work.
4. Add the new image path to the service worker's precache list if you want it available offline immediately after installation. Update its cache version when deploying changed files.
5. Reload while online and let the reference index rebuild. No cloud training job is required. If browser-added cards override source entries, clear that override or use a fresh browser profile to test the source catalog.

Eight is a demo target, not a reliable claim of recognition quality. Test every new card separately, particularly cards with similar names, borders, or artwork. Extra photos of the same card improve reference coverage; they do not replace a held-out test set.

## What is implemented and what is still a product feature

| Included in this prototype | Separate work for a production app |
| --- | --- |
| Camera/photo input and limited-catalog artwork matching | Large catalog recognition validated on real users' photos |
| Unknown/uncertain-match handling and manual confirmation | Measured production accuracy, accessibility audit, and device compatibility testing |
| Labeled example price comparisons | Licensed live pricing feeds, condition normalization, currency/fee handling, and timestamps |
| Collection and reference data stored in the current browser | Accounts, secure cloud synchronization, backups, and user support |
| Static deployment and app-like Home Screen access | Native App Store release, payments, subscriptions, and app-store review |

The displayed example prices and any visual price comparisons are **fictional demonstration data**, not live quotes. Selecting condition does not grade a card. The app identifies visual artwork; it does not authenticate a physical card, detect a counterfeit reliably, assess surface damage, or guarantee the edition, language, or value of a copy. Always confirm the printed card number and variant.

## Privacy and storage

Scans are processed by JavaScript on the device. This build has no scan-upload endpoint, paid inference service, analytics, or advertising SDK. User-added reference images and saved collection entries stay in the browser's local storage/database until removed or browser data is cleared. A hosting provider still receives ordinary requests for the website's files. Marketplace links, if followed, open third-party sites.

If bundled reference files are missing, the remote-image fallback also requests artwork from the source listed in the catalog. That server receives a normal image request and your network address; the app does not send it the photo being scanned. Run setup and deploy the local images to avoid relying on this external reference request.

Safari can reclaim website storage under some conditions. Keep an exported catalog/training pack and collection backup before changing phones, clearing Safari data, or relying on the app for a demonstration. “Add to Home Screen” does not create a cloud backup.

## Presentation checklist

1. Open the final HTTPS URL on the actual iPhone while online and confirm all intended references are indexed.
2. Try each supported physical card in good light, in a sleeve, at a moderate angle, and on different backgrounds.
3. Try unrelated cards, a card back, an empty desk, and a similar variant. Confirm that weak matches ask for another photo or user confirmation.
4. Keep the whole card visible, fill most of the guide, avoid severe perspective, and move the light rather than pointing bright glare at foil artwork.
5. Test camera denial and the photo-upload fallback. Verify add/remove collection, export/import, and page reload.
6. If using offline mode, load the app and references online first, then explicitly test airplane mode on that iPhone. Initial reference downloads and external marketplace pages require a connection.
7. Record results in a small table: true card, lighting/sleeve condition, predicted card, match/rejection, and response time. Test fresh photos rather than reporting success on the reference image itself.

## Troubleshooting

| Symptom | What to try |
| --- | --- |
| Camera button cannot open a stream | Use HTTPS or computer `localhost`, open in a top-level tab, allow camera permission, and close other camera apps |
| Replit preview shows a permission error | Open the preview URL in a new Safari tab or use the published HTTPS URL |
| Card is missing or not indexed | Check the printed number, image path, internet connection for any remote reference, and model status; attach a local reference photo |
| “No confident match” | Improve light/focus, reduce glare and tilt, move closer while keeping all corners visible, and add photos representing the real sleeve/lighting |
| A similar printing matches | Check the card number manually and add exact-printing references; the prototype is artwork matching, not authentication |
| New source code is not appearing | Refresh online, close and reopen the app, check the worker cache version, and remove website data only after exporting local work |
| Works on computer but not phone | Use the actual hosted HTTPS URL; the phone's `localhost` and plain HTTP LAN URLs are not the computer's secure development origin |

## Sources and reference-image provenance

Documentation was checked on 15 November 2026. Hosting plans and interfaces can change.

- [GitHub Pages quickstart](https://docs.github.com/en/pages/quickstart) — free-plan repository visibility and branch publishing.
- [GitHub Pages HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https) — HTTPS availability and enforcement.
- [Replit Starter plan](https://docs.replit.com/billing/plans/starter-plan) — current free-publishing allowance and its expiration.
- [Replit import options](https://docs.replit.com/build/import-from-providers) — GitHub and ZIP project imports.
- [Replit deployment types](https://docs.replit.com/features/publishing/deployment-types) — static publishing serves files without an app backend.
- [MDN: `getUserMedia`](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) — camera permissions, secure contexts, and iframe restrictions.
- [Official Evolving Skies checklist](https://assets.pokemon.com/assets/cms2/pdf/trading-card-game/checklist/swsh7_web_cardlist_en.pdf) — Umbreon V #189.
- [Official Unbroken Bonds checklist](https://assets.pokemon.com/assets/cms2/pdf/trading-card-game/checklist/sm10_web_cardlist_en.pdf) — Gardevoir & Sylveon-GX #204 and #205.
- [Gardevoir & Sylveon-GX #205 variant details](https://senseiset.com/cards/sm10-205) and [#204 variant details](https://www.pulllist.org/cards/sm10-204) — exact artwork labels, release year, and illustrators.
- Reference artwork source URLs: [Umbreon V #189](https://images.pokemontcg.io/swsh7/189_hires.png), [Gardevoir & Sylveon-GX #205](https://images.pokemontcg.io/sm10/205_hires.png), [Gardevoir & Sylveon-GX #204](https://images.pokemontcg.io/sm10/204_hires.png). See `assets/cards/README.md` for asset handling. Card artwork and Pokémon branding belong to their respective owners; the app code's license does not grant artwork rights.

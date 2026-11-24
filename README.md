# Christmas Memory

An interactive Christmas tree made of light. Open the crystal globe to collect photos, dates and messages, then play them back in an annual review. The tree and effects respond to mouse and touch input.

## Run locally

Use Node.js 22 and npm.

```sh
npm ci
npm run dev
npm run build
```

`npm run build` produces a static website in `dist`. For GitHub Pages, select **GitHub Actions** under **Settings → Pages**, then run **Deploy to GitHub Pages** in the Actions tab.

## Photo storage

Photos, titles and messages are stored in IndexedDB in the browser. Each browser and site origin has its own collection. Sharing the site URL lets friends make their own tree. Clearing site data removes the local collection.

The sample photographs used during development are omitted from this release. Scene artwork and effects are generated in code. Bundled fonts and other dependencies are distributed under their respective licenses.

Project code is offered under the [MIT License](LICENSE).

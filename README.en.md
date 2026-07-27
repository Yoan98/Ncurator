# Ncurator: AI Assistant

[中文](./README.md) · [Official Website](https://www.ncurator.com/en)

A lightweight browser companion for Ncurator Desktop. It displays browser bookmarks and copies every URL in one click, one URL per line.

## Privacy

Bookmark data is processed locally in the browser. The extension never modifies, stores, or uploads bookmarks and contains no analytics or tracking code.

## Development

```bash
npm install
npm run dev
```

Load `.output/chrome-mv3` as an unpacked extension in Chrome. For Edge, run `npm run dev:edge` and load `.output/edge-mv3`.

## Verify and build

```bash
npm run typecheck
npm test
npm run build
npm run build:edge
npm run zip
npm run zip:edge
```

Store copy and the release checklist are in [`docs`](./docs). Store artwork is in [`store-assets`](./store-assets).

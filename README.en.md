# Ncurator: AI Assistant

[中文](./README.md) · [Official Website](https://www.ncurator.com/en) · [Privacy Policy](https://www.ncurator.com/en/privacy/browser-extension)

Ncurator is your AI work partner. Give it a task and let it research, use your local knowledge base, organize information, and create documents.

The complete experience is available on macOS and Windows.

## Browser extension

The browser extension provides a focused bookmark tool:

- View bookmark titles, folders, and URLs
- Copy every bookmarked URL in one click, one URL per line
- Support nested bookmark folders
- Preserve the browser's original bookmark order
- Process all bookmark data locally in the browser

The extension only requests the `bookmarks` permission. It never creates, modifies, or deletes bookmarks and contains no advertising, analytics, or tracking code.

## Local development

```bash
npm install
npm run dev
```

Load `.output/chrome-mv3` as an unpacked extension in Chrome. For Edge, run `npm run dev:edge` and load `.output/edge-mv3`.

## Verify and build

```bash
npm run check
npm run zip:stores
```

Store copy and artwork are in [`store-assets`](./store-assets). Store credentials are kept in the local `.env` file and are never committed to Git.

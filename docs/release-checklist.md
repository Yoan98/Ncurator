# Release Checklist

## Code and behavior

- [ ] Version is higher than the currently published version.
- [ ] Chrome and Edge manifests request only `bookmarks`.
- [ ] No host permissions, content scripts, remote code, analytics, or tracking.
- [ ] Nested folders, empty bookmarks, duplicate URLs, and long URLs work.
- [ ] Copied output contains one URL per line with no trailing newline.
- [ ] Chinese and English browser locales display correctly.
- [ ] Website link opens only after the user clicks it.

## Verification

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run build:edge`
- [ ] Load `.output/chrome-mv3` in Chrome.
- [ ] Load `.output/edge-mv3` in Edge.
- [ ] Inspect both ZIP files and confirm `manifest.json` is at the root.

## Website and store

- [ ] Privacy policy is deployed at both public URLs.
- [ ] Existing listing text and images are backed up.
- [ ] Store name, short description, detailed description, and screenshots are updated.
- [ ] Single-purpose and `bookmarks` permission explanations are entered.
- [ ] Data-use disclosures match the public privacy policy.
- [ ] Reviewer notes and test steps are included.
- [ ] Chrome extension ID remains `jdlfflbeekclkgcckcfombmfojmcdeio`.
- [ ] Edge extension ID remains `hkdfdbpkmkpooopbkdghecbaipeoijpj`.

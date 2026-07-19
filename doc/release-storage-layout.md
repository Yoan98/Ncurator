# Release storage layout

Windows and macOS releases are finalized independently.

```text
artifacts/windows/vX.Y.Z/*
artifacts/macos/vX.Y.Z/*
release-status/windows/vX.Y.Z.json
release-status/macos/vX.Y.Z/macos-arm64.json
release-status/macos/vX.Y.Z/macos-x64.json
updates/latest/latest.yml
updates/latest/latest-mac.yml
releases/latest/windows.json
releases/latest/macos.json
downloads/latest/windows-x64.exe
downloads/latest/macos-arm64.dmg
downloads/latest/macos-x64.dmg
```

Each platform finalize operation updates only its own metadata, fixed downloads, and manifest.
It then removes older objects only for that platform. Technical artifact names remain ASCII and
stable. The fixed download objects use `Content-Disposition` so users receive installers named
with the product display name.

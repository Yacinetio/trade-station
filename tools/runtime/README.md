# Runtime build scripts

Used by `npm run build` and related packaging scripts.

- `prepare-electron-build.mjs` — pre-build checks and asset prep
- `generate-app-icon.mjs` — build `public/icon.ico` from `public/brand-mark.svg`

## Build outputs

- `dist/Trade-Station-Setup.exe` — Windows NSIS installer
- `dist/win-unpacked/` — unpacked app folder

Portable build (`npm run build:portable` or repo root `build-portable.bat`):

- `dist/portable/Trade-Station-Portable.exe`
- `dist/portable/win-unpacked/Trade Station.exe`

`npm run build` alone does **not** produce the portable EXE.

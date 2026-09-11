/**
 * Prepare electron-builder output folders (Windows-friendly cleanup).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const distDir = path.join(root, 'dist');

function run(cmd) {
  try {
    execSync(cmd, { stdio: 'ignore', windowsHide: true });
  } catch {
    /* best effort */
  }
}

function sleep(ms) {
  if (process.platform === 'win32') {
    const sec = Math.max(1, Math.ceil(ms / 1000));
    run(`timeout /t ${sec} /nobreak >nul`);
    return;
  }
  execSync('node -e "setTimeout(()=>{},' + ms + ')"', { stdio: 'ignore' });
}

function rmDirRecursive(target) {
  if (!fs.existsSync(target)) return true;
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 400 });
    return !fs.existsSync(target);
  } catch {
    return false;
  }
}

function clearUnpacked(parentDir, label) {
  const unpackedDir = path.join(parentDir, 'win-unpacked');
  if (!fs.existsSync(unpackedDir)) return;
  if (rmDirRecursive(unpackedDir)) return;

  const staleName = `win-unpacked.stale.${Date.now()}`;
  const stalePath = path.join(parentDir, staleName);
  try {
    fs.renameSync(unpackedDir, stalePath);
    console.warn(`[prepare-electron-build] Renamed locked ${label} to ${staleName}`);
    setTimeout(() => {
      try { fs.rmSync(stalePath, { recursive: true, force: true }); } catch { /* noop */ }
    }, 90_000).unref?.();
  } catch (err) {
    console.error(`[prepare-electron-build] Cannot clear ${label}:`, err?.message || err);
    console.error('Close Trade Station / Explorer on that folder, then retry.');
    process.exit(1);
  }
}

if (process.platform === 'win32') {
  run('taskkill /F /IM "Trade Station.exe"');
  run('taskkill /F /IM TradeSync.exe');
  run('taskkill /F /IM electron.exe');
  sleep(1500);
}

fs.mkdirSync(distDir, { recursive: true });
fs.mkdirSync(path.join(distDir, 'portable'), { recursive: true });

const portableOnly = process.argv.includes('--portable-only') || process.env.ELECTRON_BUILD_SCOPE === 'portable';

clearUnpacked(path.join(distDir, 'portable'), 'dist/portable/win-unpacked');
if (!portableOnly) {
  clearUnpacked(distDir, 'dist/win-unpacked');
}

for (const file of [
  'Trade-Station-Portable.exe',
  'Trade-Station-Setup.exe',
  'Trade-Station-Demo-Portable.exe',
  'Trade-Station-Live-Portable.exe',
  'Trade-Station-Funded-Portable.exe',
  'Trade-Station-Prop-Portable.exe',
]) {
  for (const dir of [distDir, path.join(distDir, 'portable')]) {
    const p = path.join(dir, file);
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch { /* noop */ }
    }
  }
}

console.log('[prepare-electron-build] dist folders ready for electron-builder');

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const {
  listDataFiles,
  buildBackupManifest,
  exportDataRootToZip,
  resolveBackupSourceRoot,
  mergeRestoreFromExtracted,
  importDataZipToRoot,
  shouldIncludeAccountPath
} = require('../src/main/dataBackupService');

describe('dataBackupService', () => {
  let tmpRoot = '';

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-backup-test-'));
    fs.mkdirSync(path.join(tmpRoot, 'accounts', 'demo'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'accounts', 'live'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'tradesync-config.json'), '{"settings":{}}', 'utf8');
    fs.writeFileSync(path.join(tmpRoot, 'accounts', 'demo', 'trades.json'), '[]', 'utf8');
    fs.writeFileSync(path.join(tmpRoot, 'accounts', 'live', 'trades.json'), '[]', 'utf8');
  });

  afterEach(() => {
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('lists files under data root', () => {
    const files = listDataFiles(tmpRoot);
    expect(files.length).toBe(3);
    expect(files.some((f) => f.rel === 'tradesync-config.json')).toBe(true);
    expect(files.some((f) => f.rel.includes('accounts/demo/trades.json'))).toBe(true);
    expect(files.some((f) => f.rel.includes('accounts/live/trades.json'))).toBe(true);
  });

  it('filters account folders when includeAccountKeys is set', () => {
    const files = listDataFiles(tmpRoot, { includeAccountKeys: ['demo'] });
    expect(files.length).toBe(2);
    expect(files.some((f) => f.rel.includes('accounts/demo/trades.json'))).toBe(true);
    expect(files.some((f) => f.rel.includes('accounts/live/trades.json'))).toBe(false);
  });

  it('keeps non-account files when no accounts are selected', () => {
    const files = listDataFiles(tmpRoot, { includeAccountKeys: [] });
    expect(files.length).toBe(1);
    expect(files[0].rel).toBe('tradesync-config.json');
  });

  it('matches account paths with sanitized keys', () => {
    expect(shouldIncludeAccountPath('accounts/demo/trades.json', ['demo'])).toBe(true);
    expect(shouldIncludeAccountPath('accounts/live/trades.json', ['demo'])).toBe(false);
    expect(shouldIncludeAccountPath('tradesync-config.json', ['demo'])).toBe(true);
  });

  it('excludes the output zip path from inventory', () => {
    const zipPath = path.join(tmpRoot, 'backup.zip');
    const files = listDataFiles(tmpRoot, { excludeAbsPaths: [zipPath] });
    expect(files.some((f) => f.abs === zipPath)).toBe(false);
  });

  it('builds manifest metadata', () => {
    const files = listDataFiles(tmpRoot);
    const manifest = buildBackupManifest({
      dataRoot: tmpRoot,
      files,
      appVersion: '1.1.0',
      deviceId: 'dev-1',
      includeAccountKeys: ['demo']
    });
    expect(manifest.format).toBe('trade-station-data-backup-v1');
    expect(manifest.fileCount).toBe(3);
    expect(manifest.appVersion).toBe('1.1.0');
    expect(manifest.includedAccountKeys).toEqual(['demo']);
  });

  it('resolves TradeStation-data folder inside extracted zip', () => {
    const extracted = path.join(tmpRoot, 'extracted');
    const source = path.join(extracted, 'TradeStation-data');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'tradesync-config.json'), '{"settings":{}}', 'utf8');
    expect(resolveBackupSourceRoot(extracted)).toBe(source);
  });

  it('merges restore without deleting extra local files', () => {
    const src = path.join(tmpRoot, 'src');
    const dest = path.join(tmpRoot, 'dest');
    fs.mkdirSync(path.join(src, 'accounts', 'a'), { recursive: true });
    fs.mkdirSync(path.join(dest, 'accounts', 'b'), { recursive: true });
    fs.writeFileSync(path.join(src, 'tradesync-config.json'), '{"settings":{"lotMode":"signal"}}', 'utf8');
    fs.writeFileSync(path.join(src, 'accounts', 'a', 'trades.json'), '[{"id":"1"}]', 'utf8');
    fs.writeFileSync(path.join(dest, 'local-only.txt'), 'keep me', 'utf8');
    fs.writeFileSync(path.join(dest, 'accounts', 'b', 'trades.json'), '[]', 'utf8');

    const result = mergeRestoreFromExtracted({ sourceRoot: src, dataRoot: dest });
    expect(result.copied).toBe(2);
    expect(fs.existsSync(path.join(dest, 'local-only.txt'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'accounts', 'b', 'trades.json'))).toBe(true);
    expect(fs.readFileSync(path.join(dest, 'tradesync-config.json'), 'utf8')).toContain('signal');
  });

  it('imports zip backup end-to-end', async () => {
    const liveRoot = path.join(tmpRoot, 'live');
    const backupRoot = path.join(tmpRoot, 'backup-src');
    fs.mkdirSync(path.join(backupRoot, 'accounts', 'restored'), { recursive: true });
    fs.writeFileSync(path.join(backupRoot, 'tradesync-config.json'), '{"settings":{"lotMode":"fixed"}}', 'utf8');
    fs.writeFileSync(path.join(backupRoot, 'accounts', 'restored', 'trades.json'), '[{"id":"r1"}]', 'utf8');
    fs.mkdirSync(liveRoot, { recursive: true });
    fs.writeFileSync(path.join(liveRoot, 'local-only.txt'), 'stay', 'utf8');

    const zipPath = path.join(os.tmpdir(), `ts-restore-${Date.now()}.zip`);
    await exportDataRootToZip({ dataRoot: backupRoot, zipPath, appVersion: '1.1.0', deviceId: 'dev-1' });
    const restored = await importDataZipToRoot({
      dataRoot: liveRoot,
      zipPath,
      createSafetyBackup: false,
      appVersion: '1.1.0',
      deviceId: 'dev-1'
    });
    expect(restored.copied).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(liveRoot, 'local-only.txt'))).toBe(true);
    expect(fs.readFileSync(path.join(liveRoot, 'tradesync-config.json'), 'utf8')).toContain('fixed');
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  });

  it('creates a zip without deleting source files', () => {
    const zipPath = path.join(os.tmpdir(), `ts-backup-out-${Date.now()}.zip`);
    const before = listDataFiles(tmpRoot);
    return exportDataRootToZip({
      dataRoot: tmpRoot,
      zipPath,
      appVersion: '1.1.0',
      deviceId: 'dev-1'
    }).then((result) => {
      expect(result.success !== false).toBe(true);
      expect(fs.existsSync(zipPath)).toBe(true);
      expect(fs.existsSync(path.join(tmpRoot, 'tradesync-config.json'))).toBe(true);
      const after = listDataFiles(tmpRoot);
      expect(after.length).toBe(before.length);
    }).finally(() => {
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    });
  });
});

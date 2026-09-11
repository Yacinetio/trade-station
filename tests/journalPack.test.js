import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
const { exportPack, importPack } = require('../src/main/journalPack');

describe('journalPack', () => {
  let tmpRoot = '';
  let zipPath = '';

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-journal-pack-'));
    zipPath = path.join(tmpRoot, 'pack.zip');
    fs.mkdirSync(path.join(tmpRoot, 'attachments', 'trades', 't1'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'attachments', 'trades', 't1', 'chart.png'), 'png', 'utf8');
    fs.writeFileSync(path.join(tmpRoot, 'notebook.json'), JSON.stringify({
      notes: [{ id: 'n1', title: 'Plan', folder: 'Journal', body: 'hello', createdAt: '2026-01-01', updatedAt: '2026-01-01' }]
    }), 'utf8');
    fs.writeFileSync(path.join(tmpRoot, 'strategies.json'), JSON.stringify({
      strategies: [{ id: 's1', name: 'Breakout', rules: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
      missed: []
    }), 'utf8');
  });

  afterEach(() => {
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  const sampleTrades = () => ([
    {
      id: 't1',
      accountKey: 'live',
      symbol: 'XAUUSD',
      profit: 120,
      status: 'CLOSED_TP',
      closedAt: '2026-01-02T12:00:00.000Z'
    },
    {
      id: 't2',
      accountKey: 'demo',
      symbol: 'EURUSD',
      profit: -50,
      status: 'CLOSED_SL',
      closedAt: '2026-01-03T12:00:00.000Z'
    }
  ]);

  it('exports and imports with id remapping and shared account scope', async () => {
    const trades = sampleTrades();
    await exportPack({
      dataRoot: tmpRoot,
      trades,
      accountKeys: ['live'],
      includeNotebook: true,
      includeStrategies: true,
      outPath: zipPath
    });

    const destRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-journal-import-'));
    try {
      const currentTrades = [{ id: 'existing', accountKey: 'live', profit: 1, status: 'CLOSED_TP' }];
      const result = await importPack({
        dataRoot: destRoot,
        zipPath,
        currentTrades
      });

      expect(result.tradesImported).toBe(1);
      expect(result.notesImported).toBe(1);
      expect(result.strategiesImported).toBe(1);
      expect(result.trades[0].id).toMatch(/^shared-/);
      expect(result.trades[0].accountKey).toBe('shared:live');
      expect(result.trades[0].readOnlyScope).toBe(true);

      const notebook = JSON.parse(fs.readFileSync(path.join(destRoot, 'notebook.json'), 'utf8'));
      expect(notebook.notes[0].folder).toBe('Shared');
      expect(notebook.notes[0].id).toMatch(/^shared-/);

      const strategies = JSON.parse(fs.readFileSync(path.join(destRoot, 'strategies.json'), 'utf8'));
      expect(strategies.strategies[0].imported).toBe(true);

      expect(fs.existsSync(path.join(destRoot, 'attachments', 'trades', result.trades[0].id, 'chart.png'))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  it('skips trades whose original id already exists', async () => {
    const trades = sampleTrades();
    await exportPack({ dataRoot: tmpRoot, trades, outPath: zipPath });

    const destRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-journal-skip-'));
    try {
      const currentTrades = [{ id: 't1', accountKey: 'live', profit: 1, status: 'CLOSED_TP' }];
      const result = await importPack({ dataRoot: destRoot, zipPath, currentTrades });
      expect(result.skipped).toBeGreaterThan(0);
      expect(result.tradesImported).toBe(1);
      expect(result.trades.every((t) => t.id !== 't1')).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  it('rejects garbage zip without valid manifest', async () => {
    const badZip = path.join(tmpRoot, 'bad.zip');
    fs.writeFileSync(badZip, 'not a zip', 'utf8');
    const destRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-journal-bad-'));
    try {
      await expect(importPack({ dataRoot: destRoot, zipPath: badZip, currentTrades: [] }))
        .rejects.toThrow();
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });
});

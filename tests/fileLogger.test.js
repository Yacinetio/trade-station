import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const fileLogger = require('../src/main/fileLogger');

function waitForFlush() {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

describe('fileLogger', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-filelogger-'));
  });

  afterEach(() => {
    fileLogger.shutdown();
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) { /* noop */ }
  });

  it('creates the logs dir on init', () => {
    expect(fileLogger.init(tmpRoot)).toBe(true);
    expect(fs.existsSync(path.join(tmpRoot, 'logs'))).toBe(true);
    expect(fileLogger.getLogsDir()).toBe(path.join(tmpRoot, 'logs'));
  });

  it('writes entries to the daily file', async () => {
    fileLogger.init(tmpRoot);
    fileLogger.writeEntry({ level: 'info', message: 'hello world', detail: 'extra' });
    fileLogger.writeEntry({ level: 'error', message: 'boom' });
    fileLogger.shutdown();
    await waitForFlush();

    const files = fs.readdirSync(path.join(tmpRoot, 'logs'));
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^app-\d{4}-\d{2}-\d{2}\.log$/);
    const content = fs.readFileSync(path.join(tmpRoot, 'logs', files[0]), 'utf8');
    expect(content).toContain('[INFO   ] hello world | extra');
    expect(content).toContain('[ERROR  ] boom');
  });

  it('flattens newlines in detail so one entry stays one block', async () => {
    fileLogger.init(tmpRoot);
    fileLogger.writeEntry({ level: 'error', message: 'stack', detail: 'line1\nline2' });
    fileLogger.shutdown();
    await waitForFlush();

    const files = fs.readdirSync(path.join(tmpRoot, 'logs'));
    const content = fs.readFileSync(path.join(tmpRoot, 'logs', files[0]), 'utf8');
    expect(content.trim().split('\n').length).toBe(1);
    expect(content).toContain('line1 \\n line2');
  });

  it('never throws when init was not called', () => {
    fileLogger.shutdown();
    expect(() => fileLogger.writeEntry({ message: 'no init' })).not.toThrow();
  });
});

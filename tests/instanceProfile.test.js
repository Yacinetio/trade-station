import { describe, it, expect } from 'vitest';
import path from 'path';

const {
  sanitizeInstanceId,
  readInstanceFromArgv,
  defaultTcpPortForInstance,
  resolveDataRoot,
  formatInstanceLabel,
} = require('../src/main/instanceProfile');

describe('instanceProfile', () => {
  it('sanitizes valid instance ids', () => {
    expect(sanitizeInstanceId('demo')).toBe('demo');
    expect(sanitizeInstanceId('live-2')).toBe('live-2');
    expect(sanitizeInstanceId('  funded  ')).toBe('funded');
  });

  it('rejects invalid instance ids', () => {
    expect(sanitizeInstanceId('')).toBe('');
    expect(sanitizeInstanceId('bad id')).toBe('');
    expect(sanitizeInstanceId('../escape')).toBe('');
  });

  it('reads --instance= from argv', () => {
    expect(readInstanceFromArgv(['electron', '.', '--instance=demo'])).toBe('demo');
    expect(readInstanceFromArgv(['electron', '.', '--instance', 'live'])).toBe('live');
  });

  it('assigns stable default ports', () => {
    expect(defaultTcpPortForInstance('demo')).toBe(9999);
    expect(defaultTcpPortForInstance('live')).toBe(10000);
    expect(defaultTcpPortForInstance('custom-a')).toBe(defaultTcpPortForInstance('custom-a'));
    expect(defaultTcpPortForInstance('custom-a')).not.toBe(defaultTcpPortForInstance('custom-b'));
  });

  it('uses isolated data roots for named instances', () => {
    const demoRoot = resolveDataRoot('demo');
    const liveRoot = resolveDataRoot('live');
    const defaultRoot = resolveDataRoot('');
    expect(demoRoot).toContain(`${path.sep}instances${path.sep}demo`);
    expect(liveRoot).not.toBe(demoRoot);
    expect(defaultRoot).not.toContain(`${path.sep}instances${path.sep}`);
  });

  it('reads instance id from portable exe filename', () => {
    const { readInstanceFromExePath } = require('../src/main/instanceProfile');
    expect(readInstanceFromExePath('C:\\apps\\Trade-Station-Demo-Portable.exe')).toBe('demo');
    expect(readInstanceFromExePath('C:\\apps\\Trade-Station-Live-Portable.exe')).toBe('live');
    expect(readInstanceFromExePath('C:\\apps\\Trade-Station-Portable.exe')).toBe('');
  });

  it('reads instance id from PORTABLE_EXECUTABLE_FILE (portable self-extract)', () => {
    const { readInstanceFromPortableEnv, resolveActiveInstanceId } = require('../src/main/instanceProfile');
    expect(readInstanceFromPortableEnv({ PORTABLE_EXECUTABLE_FILE: 'C:\\apps\\Trade-Station-Live-Portable.exe' })).toBe('live');
    expect(readInstanceFromPortableEnv({ PORTABLE_EXECUTABLE_NAME: 'Trade-Station-Demo-Portable.exe' })).toBe('demo');
    expect(readInstanceFromPortableEnv({})).toBe('');
    // Portable runtime: execPath is the extracted temp exe, env carries the real name.
    expect(resolveActiveInstanceId(
      ['C:\\Temp\\...\\Trade Station.exe'],
      'C:\\Users\\x\\AppData\\Local\\Temp\\2f\\Trade Station.exe',
      { PORTABLE_EXECUTABLE_FILE: 'D:\\code\\signal-copier\\Trade-Station-Demo-Portable.exe' }
    )).toBe('demo');
  });
});

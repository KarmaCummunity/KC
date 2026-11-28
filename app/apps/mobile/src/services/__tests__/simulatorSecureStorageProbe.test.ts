import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  probeEnabled: { current: true },
}));

vi.mock('expo-secure-store', () => ({
  setItemAsync: mocks.setItemAsync,
  getItemAsync: mocks.getItemAsync,
  deleteItemAsync: mocks.deleteItemAsync,
}));
vi.mock('expo-constants', () => ({
  default: {
    get expoConfig() {
      return { extra: { secureStorageProbeEnabled: mocks.probeEnabled.current } };
    },
  },
}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import { startSimulatorSecureStorageProbe, SECURE_STORAGE_PROBE_MARKER } from '../simulatorSecureStorageProbe';

describe('simulatorSecureStorageProbe (#856)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.probeEnabled.current = true;
    mocks.setItemAsync.mockResolvedValue(undefined);
    mocks.getItemAsync.mockResolvedValue('kc-probe-sentinel');
    mocks.deleteItemAsync.mockResolvedValue(undefined);
  });

  it('does nothing when the build flag is off', async () => {
    mocks.probeEnabled.current = false;
    await startSimulatorSecureStorageProbe();
    expect(mocks.setItemAsync).not.toHaveBeenCalled();
    expect(mocks.getItemAsync).not.toHaveBeenCalled();
  });

  it('writes, verifies and deletes its own non-credential sentinel key', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await startSimulatorSecureStorageProbe();
    expect(mocks.setItemAsync).toHaveBeenCalledWith('kc.dev.secureStorageProbe.v1', 'kc-probe-sentinel');
    expect(mocks.deleteItemAsync).toHaveBeenCalledWith('kc.dev.secureStorageProbe.v1');
    expect(log).toHaveBeenCalledWith(`${SECURE_STORAGE_PROBE_MARKER} ok`);
    expect(mocks.setItemAsync.mock.calls[0][0]).not.toContain('auth');
  });

  it('reports mismatch without throwing and still cleans up', async () => {
    mocks.getItemAsync.mockResolvedValue('unexpected');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(startSimulatorSecureStorageProbe()).resolves.toBeUndefined();
    expect(mocks.deleteItemAsync).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`${SECURE_STORAGE_PROBE_MARKER} mismatch`));
  });

  it('reports secure-store failure (e.g. missing entitlement) without throwing or plaintext fallback', async () => {
    mocks.setItemAsync.mockRejectedValue(new Error("A required entitlement isn't present"));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(startSimulatorSecureStorageProbe()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      `${SECURE_STORAGE_PROBE_MARKER} fail: A required entitlement isn't present`,
    );
    expect(mocks.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('cleans up best-effort when read-back throws after a successful write', async () => {
    mocks.getItemAsync.mockRejectedValue(new Error('read failed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(startSimulatorSecureStorageProbe()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`${SECURE_STORAGE_PROBE_MARKER} fail`));
    expect(mocks.deleteItemAsync).toHaveBeenCalled();
  });

  it('a failed delete makes the outcome non-ok without throwing, and cleanup is retried', async () => {
    mocks.deleteItemAsync.mockRejectedValue(new Error('delete failed'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(startSimulatorSecureStorageProbe()).resolves.toBeUndefined();
    expect(logSpy).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`${SECURE_STORAGE_PROBE_MARKER} fail`));
    expect(mocks.deleteItemAsync.mock.calls.length).toBe(2); // failed attempt + finally retry
  });
});

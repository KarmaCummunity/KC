// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const env = vi.hoisted(() => ({ os: 'ios', rtl: true, language: 'he', stored: null as string | null,
  load: vi.fn(), change: vi.fn(), apply: vi.fn(), reload: vi.fn() }));
vi.mock('react-native', () => ({ Platform: { get OS() { return env.os; } }, I18nManager: { get isRTL() { return env.rtl; } } }));
vi.mock('../index', () => ({ default: { get language() { return env.language; }, changeLanguage: env.change } }));
vi.mock('../language', () => ({ loadStoredLanguageAsync: env.load, applyLayoutDirection: env.apply,
  reloadApp: env.reload, isRtlLanguage: (language: string) => language === 'he' }));
import { useLanguageBootstrap } from '../useLanguageBootstrap';

describe('language bootstrap before the shell', () => {
  beforeEach(() => { vi.resetAllMocks(); env.os = 'ios'; env.rtl = true; env.language = 'he'; env.load.mockResolvedValue(null); env.change.mockResolvedValue(undefined); });
  it('does not mount the shell while the native preference is unresolved', async () => {
    let resolve!: (language: string | null) => void;
    env.load.mockReturnValue(new Promise((done) => { resolve = done; }));
    const { result } = renderHook(useLanguageBootstrap);
    expect(result.current).toBe(false);
    expect(env.apply).not.toHaveBeenCalled();
    await act(async () => { resolve(null); });
    expect(result.current).toBe(true);
    expect(env.apply).toHaveBeenCalledWith('he');
    expect(env.reload).not.toHaveBeenCalled();
  });
  it('keeps the shell unmounted across a fresh Hebrew direction restart', async () => {
    env.rtl = false;
    const { result } = renderHook(useLanguageBootstrap);
    await waitFor(() => expect(env.reload).toHaveBeenCalledTimes(1));
    expect(env.apply).toHaveBeenCalledWith('he');
    expect(result.current).toBe(false);
  });
  it('applies the saved English preference before allowing a native shell', async () => {
    env.rtl = false; env.load.mockResolvedValue('en');
    const { result } = renderHook(useLanguageBootstrap);
    await waitFor(() => expect(result.current).toBe(true));
    expect(env.change).toHaveBeenCalledWith('en');
    expect(env.apply).toHaveBeenCalledWith('en');
    expect(env.reload).not.toHaveBeenCalled();
  });
  it('does not mark a cancelled bootstrap ready after language changes', async () => {
    let resolve!: () => void;
    env.load.mockResolvedValue('en'); env.change.mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    const view = renderHook(useLanguageBootstrap);
    await waitFor(() => expect(env.change).toHaveBeenCalled());
    view.unmount(); await act(async () => { resolve(); });
    expect(env.apply).not.toHaveBeenCalled();
    expect(env.reload).not.toHaveBeenCalled();
  });
  it('leaves the synchronously bootstrapped web shell available without native reload', () => {
    env.os = 'web';
    const { result } = renderHook(useLanguageBootstrap);
    expect(result.current).toBe(true);
    expect(env.apply).toHaveBeenCalledWith('he');
    expect(env.load).not.toHaveBeenCalled();
    expect(env.reload).not.toHaveBeenCalled();
  });
  it('uses the same gate on Android before a direction-changing restart', async () => {
    env.os = 'android'; env.rtl = true; env.load.mockResolvedValue('en');
    const { result } = renderHook(useLanguageBootstrap);
    await waitFor(() => expect(env.reload).toHaveBeenCalledTimes(1));
    expect(env.apply).toHaveBeenCalledWith('en');
    expect(result.current).toBe(false);
  });
});

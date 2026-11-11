import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Platform } from 'react-native';
import { platformSelect } from '../platformSelect';

describe('platformSelect', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('selects ios value when Platform.OS is ios', () => {
    vi.spyOn(Platform, 'OS', 'get').mockReturnValue('ios');
    const result = platformSelect({
      ios: 'apple',
      android: 'google',
      web: 'browser',
    });
    expect(result).toBe('apple');
  });

  it('selects android value when Platform.OS is android', () => {
    vi.spyOn(Platform, 'OS', 'get').mockReturnValue('android');
    const result = platformSelect({
      ios: 'apple',
      android: 'google',
      web: 'browser',
    });
    expect(result).toBe('google');
  });

  it('selects web value when Platform.OS is web', () => {
    vi.spyOn(Platform, 'OS', 'get').mockReturnValue('web');
    const result = platformSelect({
      ios: 'apple',
      android: 'google',
      web: 'browser',
    });
    expect(result).toBe('browser');
  });

  it('falls back to default when platform specific value is missing', () => {
    vi.spyOn(Platform, 'OS', 'get').mockReturnValue('android');
    const result = platformSelect({
      ios: 'apple',
      default: 'fallback',
    });
    expect(result).toBe('fallback');
  });

  it('throws an error if no platform value and no default provided', () => {
    vi.spyOn(Platform, 'OS', 'get').mockReturnValue('android');
    expect(() =>
      platformSelect({
        ios: 'apple',
      }),
    ).toThrowError(/platformSelect: no value provided for platform/);
  });
});

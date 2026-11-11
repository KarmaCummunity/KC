import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Platform } from 'react-native';
import {
  getPlatformTokens,
  iosPlatformTokens,
  androidPlatformTokens,
  webPlatformTokens,
} from '../platformTokens';

describe('platformTokens', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ios platform tokens on ios', () => {
    vi.spyOn(Platform, 'OS', 'get').mockReturnValue('ios');
    const tokens = getPlatformTokens();
    expect(tokens.name).toBe('ios');
    expect(tokens.pressFeedback).toBe('opacity');
    expect(tokens.radius).toEqual(iosPlatformTokens.radius);
    expect(tokens.shadow).toEqual(iosPlatformTokens.shadow);
  });

  it('returns android platform tokens on android', () => {
    vi.spyOn(Platform, 'OS', 'get').mockReturnValue('android');
    const tokens = getPlatformTokens();
    expect(tokens.name).toBe('android');
    expect(tokens.pressFeedback).toBe('ripple');
    expect(tokens.radius).toEqual(androidPlatformTokens.radius);
    expect(tokens.shadow.card.elevation).toBe(2);
  });

  it('returns web platform tokens on web', () => {
    vi.spyOn(Platform, 'OS', 'get').mockReturnValue('web');
    const tokens = getPlatformTokens();
    expect(tokens.name).toBe('web');
    expect(tokens.pressFeedback).toBe('none');
    expect(tokens.radius).toEqual(webPlatformTokens.radius);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

function stubDocumentDir(dir: 'rtl' | 'ltr'): void {
  vi.stubGlobal('document', { documentElement: { getAttribute: () => dir } });
}

async function loadOnNative(isRTL: boolean) {
  vi.doMock('react-native', () => ({ Platform: { OS: 'ios' }, I18nManager: { isRTL } }));
  return import('../hebrewContentDirection');
}

describe('hebrewContentDirection (FR-SETTINGS-018, #1749)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('react-native');
    vi.resetModules();
  });

  it('keeps Hebrew content RTL and right-aligned on Hebrew web', async () => {
    stubDocumentDir('rtl');
    const m = await import('../hebrewContentDirection');
    expect(m.hebrewContentTextStyle()).toEqual({ writingDirection: 'rtl', textAlign: 'right' });
    expect(m.hebrewContentRowDirection()).toBe('row-reverse');
  });

  it('keeps Hebrew content RTL and right-aligned on English web', async () => {
    stubDocumentDir('ltr');
    const m = await import('../hebrewContentDirection');
    expect(m.hebrewContentTextStyle()).toEqual({ writingDirection: 'rtl', textAlign: 'right' });
    expect(m.hebrewContentRowDirection()).toBe('row-reverse');
  });

  it('puts the quote bar on the right edge on web, where `end` is the physical right', async () => {
    const m = await import('../hebrewContentDirection');
    for (const dir of ['rtl', 'ltr'] as const) {
      stubDocumentDir(dir);
      expect(m.hebrewContentRightBorder(3, 'red')).toEqual({ borderEndWidth: 3, borderEndColor: 'red' });
    }
  });

  it('uses the mirrored inline-start edge under a native RTL layout', async () => {
    const m = await loadOnNative(true);
    expect(m.hebrewContentTextAlign()).toBe('left');
    expect(m.hebrewContentRowDirection()).toBe('row');
    expect(m.hebrewContentRightBorder(3, 'red')).toEqual({ borderStartWidth: 3, borderStartColor: 'red' });
  });

  it('uses the physical right edge under a native LTR layout', async () => {
    const m = await loadOnNative(false);
    expect(m.hebrewContentTextAlign()).toBe('right');
    expect(m.hebrewContentRowDirection()).toBe('row-reverse');
    expect(m.hebrewContentRightBorder(3, 'red')).toEqual({ borderEndWidth: 3, borderEndColor: 'red' });
  });
});

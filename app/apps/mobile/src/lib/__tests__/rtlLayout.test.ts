import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  crossAxisAlignStart,
  emptyInputDirectionStyle,
  inputTextAlignStart,
  isLayoutRtl,
  layoutDirectionStyle,
  selfAlignStart,
  textAlignStart,
} from '../rtlLayout';

describe('rtlLayout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exports flex-start alignment tokens', () => {
    expect(crossAxisAlignStart).toBe('flex-start');
    expect(selfAlignStart).toBe('flex-start');
  });

  it('textAlignStart follows document dir on web', () => {
    vi.stubGlobal('document', {
      documentElement: { getAttribute: () => 'rtl' },
    });
    expect(textAlignStart()).toBe('right');

    vi.stubGlobal('document', {
      documentElement: { getAttribute: () => 'ltr' },
    });
    expect(textAlignStart()).toBe('left');
  });

  it('inputTextAlignStart returns the physical reading-start edge', () => {
    vi.stubGlobal('document', { documentElement: { getAttribute: () => 'rtl' } });
    expect(inputTextAlignStart()).toBe('right');
    vi.stubGlobal('document', { documentElement: { getAttribute: () => 'ltr' } });
    expect(inputTextAlignStart()).toBe('left');
  });

  it('emptyInputDirectionStyle pins the web placeholder to the layout direction', () => {
    vi.stubGlobal('document', { documentElement: { getAttribute: () => 'rtl' } });
    expect(emptyInputDirectionStyle()).toEqual({ writingDirection: 'rtl', textAlign: 'right' });

    vi.stubGlobal('document', { documentElement: { getAttribute: () => 'ltr' } });
    expect(emptyInputDirectionStyle()).toEqual({ writingDirection: 'ltr', textAlign: 'left' });
  });

  it('layoutDirectionStyle is a no-op (RN-Web rejects View direction)', () => {
    vi.stubGlobal('document', {
      documentElement: { getAttribute: () => 'ltr' },
    });
    expect(isLayoutRtl()).toBe(false);
    expect(layoutDirectionStyle()).toEqual({});
  });
});

describe('rtl helpers share one implementation (issue #1289)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('rtlTextAlignStart / rtlTextAlignEnd follow document dir on web and textAlignStart() returns the same edge', async () => {
    vi.stubGlobal('document', { documentElement: { getAttribute: () => 'rtl' } });
    const rtl = await import('../rtlLayout');
    expect(rtl.rtlTextAlignStart).toBe('right');
    expect(rtl.rtlTextAlignEnd).toBe('left');
    expect(rtl.textAlignStart()).toBe(rtl.rtlTextAlignStart);

    vi.resetModules();
    vi.stubGlobal('document', { documentElement: { getAttribute: () => 'ltr' } });
    const ltr = await import('../rtlLayout');
    expect(ltr.rtlTextAlignStart).toBe('left');
    expect(ltr.rtlTextAlignEnd).toBe('right');
  });

  it('the legacy modules re-export the same values', async () => {
    vi.stubGlobal('document', { documentElement: { getAttribute: () => 'ltr' } });
    const rtl = await import('../rtlLayout');
    const legacy = await import('../rtlTextAlignStart');
    const web = await import('../webRtlStyle');
    expect(legacy.rtlTextAlignStart).toBe(rtl.rtlTextAlignStart);
    expect(legacy.rtlTextAlignEnd).toBe(rtl.rtlTextAlignEnd);
    expect(web.webTextRtl).toEqual(rtl.layoutWritingDirectionStyle());
  });
});

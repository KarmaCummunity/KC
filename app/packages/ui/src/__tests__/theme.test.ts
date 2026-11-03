import { describe, it, expect } from 'vitest';
import { colors, spacing, radius, shadow, typography, fontFamily, shellDimensions, iconSize, zIndex } from '../index';

describe('theme/colors', () => {
  it('exposes the brand primary token', () => {
    expect(colors.primary).toBe('#C2410C');
  });

  it('exposes semantic status tokens (success / error / warning / info)', () => {
    expect(colors.success).toMatch(/^#[0-9A-F]{6}$/i);
    expect(colors.error).toMatch(/^#[0-9A-F]{6}$/i);
    expect(colors.warning).toMatch(/^#[0-9A-F]{6}$/i);
    expect(colors.info).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('exposes neutral surface, border, and text tokens', () => {
    expect(colors.surface).toBe('#FFFFFF');
    expect(colors.background).toBe('#FFFBF7');
    expect(colors.border).toBeDefined();
    expect(colors.textPrimary).toBeDefined();
    expect(colors.textSecondary).toBeDefined();
  });

  it('treats every color value as a string', () => {
    for (const value of Object.values(colors)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });
});

describe('theme/spacing', () => {
  it('exposes the canonical t-shirt scale', () => {
    expect(spacing.xs).toBe(4);
    expect(spacing.sm).toBe(8);
    expect(spacing.md).toBe(12);
    expect(spacing.base).toBe(16);
    expect(spacing.lg).toBe(20);
    expect(spacing.xl).toBe(24);
  });

  it('keeps the scale monotonically increasing', () => {
    const ordered = [
      spacing.xs,
      spacing.sm,
      spacing.md,
      spacing.base,
      spacing.lg,
      spacing.xl,
      spacing['2xl'],
      spacing['3xl'],
      spacing['4xl'],
    ];
    for (let i = 1; i < ordered.length; i += 1) {
      expect(ordered[i]).toBeGreaterThan(ordered[i - 1]);
    }
  });
});

describe('theme/radius', () => {
  it('exposes the standard radius scale plus `full`', () => {
    expect(radius.xs).toBe(4);
    expect(radius.sm).toBe(8);
    expect(radius.md).toBe(12);
    expect(radius.lg).toBe(16);
    expect(radius.xl).toBe(24);
    expect(radius.full).toBeGreaterThan(1000);
  });
});

describe('theme/shadow', () => {
  it('exposes a card and modal preset with the React Native shadow shape', () => {
    expect(shadow.card).toEqual(
      expect.objectContaining({
        shadowColor: expect.any(String),
        shadowOffset: expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }),
        shadowOpacity: expect.any(Number),
        shadowRadius: expect.any(Number),
        elevation: expect.any(Number),
      }),
    );
    expect(shadow.modal.elevation).toBeGreaterThan(shadow.card.elevation);
  });

  it('exposes a brand-coloured glow for primary calls to action (D87)', () => {
    expect(shadow.glow.shadowColor).toBe(colors.primary);
    expect(shadow.glow.shadowOffset).toEqual({ width: 0, height: 4 });
    expect(shadow.glow.shadowOpacity).toBe(0.3);
    expect(shadow.glow.shadowRadius).toBe(8);
    expect(shadow.glow.elevation).toBe(4);
  });
});

describe('theme/iconSize', () => {
  it('exposes the six-step Ionicons scale (D87)', () => {
    expect(iconSize).toEqual({ xs: 14, sm: 16, md: 18, lg: 20, xl: 22, '2xl': 24 });
  });

  it('keeps the scale strictly increasing and on even points', () => {
    const ordered = Object.values(iconSize);
    for (let i = 1; i < ordered.length; i += 1) {
      expect(ordered[i]).toBeGreaterThan(ordered[i - 1]);
    }
    for (const size of ordered) expect(size % 2).toBe(0);
  });
});

describe('theme/zIndex', () => {
  it('names the stacking layers the app uses (D87)', () => {
    expect(zIndex).toEqual({ base: 0, raised: 1, overlay: 2, floating: 20, toast: 9999 });
  });

  it('orders the layers from the document flow up to toasts', () => {
    const ordered = [zIndex.base, zIndex.raised, zIndex.overlay, zIndex.floating, zIndex.toast];
    for (let i = 1; i < ordered.length; i += 1) {
      expect(ordered[i]).toBeGreaterThan(ordered[i - 1]);
    }
  });
});

describe('theme/typography', () => {
  it('exposes h1-h4 with numeric font sizes and line heights', () => {
    for (const key of ['h1', 'h2', 'h3', 'h4'] as const) {
      expect(typeof typography[key].fontSize).toBe('number');
      expect(typeof typography[key].lineHeight).toBe('number');
      expect(typography[key].lineHeight).toBeGreaterThan(typography[key].fontSize);
    }
  });

  it('exposes body and button presets', () => {
    expect(typography.body.fontSize).toBe(14);
    expect(typography.bodyLarge.fontSize).toBe(16);
    expect(typography.button.fontWeight).toBe('600');
  });

  it('resolves a non-empty fontFamily string', () => {
    expect(typeof fontFamily).toBe('string');
    expect(fontFamily.length).toBeGreaterThan(0);
  });
});

describe('shellDimensions', () => {
  it('exposes shell layout dimensions', () => {
    expect(shellDimensions.railCollapsed).toBe(60);
    expect(shellDimensions.railExpanded).toBe(220);
    expect(shellDimensions.aside).toBe(280);
    expect(shellDimensions.contentMaxWide).toBe(720);
    expect(shellDimensions.contentMaxDesktop).toBe(680);
    expect(shellDimensions.contentMaxTablet).toBe(640);
    expect(shellDimensions.contentMaxNarrow).toBe(600);
  });
});

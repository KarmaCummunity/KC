import { describe, expect, it } from 'vitest';
import { postDetailScrollBottomInset } from '../postDetailBottomMetrics';

describe('postDetailScrollBottomInset', () => {
  it('stacks owner bar and composer in one chrome reserve', () => {
    const inset = postDetailScrollBottomInset({
      tabBarOverlayInset: 90,
      hasOwnerBar: true,
      hasComposer: true,
    });
    expect(inset).toBeGreaterThan(90);
    expect(inset).toBeLessThan(280);
  });

  it('adds floating CTA reserve for viewers', () => {
    const base = postDetailScrollBottomInset({ tabBarOverlayInset: 0, hasComposer: true });
    const withCta = postDetailScrollBottomInset({
      tabBarOverlayInset: 0,
      hasComposer: true,
      floatingCtaReserve: 72,
    });
    expect(withCta - base).toBe(72);
  });
});

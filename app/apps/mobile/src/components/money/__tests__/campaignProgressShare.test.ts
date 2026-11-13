import { describe, it, expect, vi } from 'vitest';

vi.mock('@kc/ui', () => ({ makeUseStyles: () => () => ({}), radius: {}, spacing: {}, typography: {}, Text: () => null }));

const { campaignProgressShare } = await import('../CampaignProgressBar');

describe('campaignProgressShare (FR-ORG-010)', () => {
  it('is the share of the goal raised', () => {
    expect(campaignProgressShare(62500, 250000)).toBe(0.25);
  });

  it('stops at a full bar past the goal and is empty without a goal or a gift', () => {
    expect(campaignProgressShare(300000, 250000)).toBe(1);
    expect(campaignProgressShare(5000, 0)).toBe(0);
    expect(campaignProgressShare(0, 250000)).toBe(0);
  });
});

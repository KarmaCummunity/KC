import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ShareResearchOutcome } from '../shareResearchSurvey';

const mockShareResearchSurvey = vi.fn();
const mockTrack = vi.fn();

vi.mock('../shareResearchSurvey', () => ({
  shareResearchSurvey: (...args: unknown[]) => mockShareResearchSurvey(...args),
}));

vi.mock('../analytics', () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

import { triggerResearchShare } from '../triggerResearchShare';

const labels = {
  title: 'Research Survey',
  message: 'Please take our survey',
  toastShared: 'Link shared successfully',
  toastCopied: 'Link copied to clipboard',
  toastFailed: 'Could not share link',
};

describe('triggerResearchShare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('triggers share and tracks initiation without toast when showToast is omitted', async () => {
    const outcome: ShareResearchOutcome = { kind: 'shared' };
    mockShareResearchSurvey.mockResolvedValueOnce(outcome);

    const result = await triggerResearchShare('settings', labels);

    expect(result).toEqual(outcome);
    expect(mockShareResearchSurvey).toHaveBeenCalledWith({
      webBaseUrl: expect.any(String),
      src: 'settings',
      title: labels.title,
      message: labels.message,
    });
    expect(mockTrack).toHaveBeenCalledWith('research_share_initiated', {
      slug: 'alt-platforms-research',
      src: 'settings',
      outcome: 'shared',
    });
  });

  it('shows success toast when outcome is shared', async () => {
    const showToast = vi.fn();
    mockShareResearchSurvey.mockResolvedValueOnce({ kind: 'shared' });

    await triggerResearchShare('feed', labels, showToast);

    expect(showToast).toHaveBeenCalledWith(labels.toastShared, 'success', 2200);
  });

  it('shows success toast when outcome is copied', async () => {
    const showToast = vi.fn();
    mockShareResearchSurvey.mockResolvedValueOnce({ kind: 'copied' });

    await triggerResearchShare('feed', labels, showToast);

    expect(showToast).toHaveBeenCalledWith(labels.toastCopied, 'success', 2200);
  });

  it('shows error toast when outcome is failed', async () => {
    const showToast = vi.fn();
    mockShareResearchSurvey.mockResolvedValueOnce({ kind: 'failed' });

    await triggerResearchShare('feed', labels, showToast);

    expect(showToast).toHaveBeenCalledWith(labels.toastFailed, 'error', 2200);
  });

  it('does not show toast when outcome is dismissed', async () => {
    const showToast = vi.fn();
    mockShareResearchSurvey.mockResolvedValueOnce({ kind: 'dismissed' });

    await triggerResearchShare('feed', labels, showToast);

    expect(showToast).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' as 'ios' | 'android' | 'web' },
  Share: { share: vi.fn(), sharedAction: 'sharedAction', dismissedAction: 'dismissedAction' },
}));

import { Platform, Share } from 'react-native';
import { copyOrShareText } from '../copyOrShareText';

const shareMock = Share.share as ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.unstubAllGlobals();
  shareMock.mockReset();
  (Platform as { OS: string }).OS = 'ios';
});

describe('copyOrShareText', () => {
  it('copies to the browser clipboard on web', async () => {
    (Platform as { OS: string }).OS = 'web';
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyOrShareText('0500000000')).toEqual({ kind: 'copied' });
    expect(writeText).toHaveBeenCalledWith('0500000000');
  });

  it('reports a failure on web without a clipboard instead of throwing', async () => {
    (Platform as { OS: string }).OS = 'web';
    vi.stubGlobal('navigator', {});
    expect(await copyOrShareText('0500000000')).toEqual({ kind: 'failed', reason: 'no_clipboard' });
  });

  it('opens the share sheet on native and reports the outcome', async () => {
    shareMock.mockResolvedValueOnce({ action: 'sharedAction' });
    expect(await copyOrShareText('0500000000')).toEqual({ kind: 'shared' });
    expect(shareMock).toHaveBeenCalledWith({ message: '0500000000' });
    shareMock.mockResolvedValueOnce({ action: 'dismissedAction' });
    expect(await copyOrShareText('0500000000')).toEqual({ kind: 'dismissed' });
  });

  it('turns a share-sheet error into a failed outcome', async () => {
    shareMock.mockRejectedValueOnce(new Error('boom'));
    expect(await copyOrShareText('0500000000')).toEqual({ kind: 'failed', reason: 'boom' });
  });
});

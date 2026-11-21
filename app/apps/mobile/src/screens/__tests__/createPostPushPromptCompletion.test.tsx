// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const io = vi.hoisted(() => ({ back: vi.fn(), register: vi.fn() }));
vi.mock('expo-router', () => ({ useRouter: () => ({ back: io.back, canGoBack: () => true }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../components/EnablePushModal', () => ({ EnablePushModal: ({ onAccept, onDecline }: { onAccept: () => void; onDecline: () => void }) => <><button onClick={onAccept}>Enable</button><button onClick={onDecline}>Later</button></> }));
vi.mock('../../components/NotifyModal', () => ({ NotifyModal: () => null }));
vi.mock('../../components/post/ConfirmActionModal', () => ({ ConfirmActionModal: () => null }));
vi.mock('../../components/post/DraftResumeModal', () => ({ DraftResumeModal: () => null }));
vi.mock('../../lib/notifications', () => ({ registerCurrentDeviceIfPermitted: io.register }));
vi.mock('../../lib/container', () => ({ container: { deviceRepo: {} } }));
import { CreatePostScreenOverlays } from '../tabs/CreatePostScreenOverlays';
import type { ComponentProps } from 'react';
const props = (): ComponentProps<typeof CreatePostScreenOverlays> => ({
  draftResumeVisible: false, onDraftContinue: vi.fn(), onDraftStartFresh: vi.fn(),
  pushGate: { modalState: { visible: true, trigger: 'first-post-published' }, presentPrePrompt: vi.fn(), handleAccept: vi.fn().mockResolvedValue('granted'), handleDecline: vi.fn().mockResolvedValue(undefined) },
  ownerId: 'member', notify: null, onNotifyDismiss: vi.fn(), publishFollowersOpen: false, followersCount: 0,
  setPublishFollowersOpen: vi.fn(), setVisibility: vi.fn(), visibilityRef: { current: 'Public' }, runPublishAfterGate: vi.fn(),
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('first-post contextual permission completion', () => {
  it('registers only on granted acceptance and returns to the prior screen', async () => {
    const p = props(); render(<CreatePostScreenOverlays {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
    await waitFor(() => expect(io.back).toHaveBeenCalledOnce());
    expect(io.register).toHaveBeenCalledWith('member', { deviceRepo: {} });
  });
  it('lets Maybe later return normally without registration or OS prompt', async () => {
    const p = props(); render(<CreatePostScreenOverlays {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(io.back).toHaveBeenCalledOnce());
    expect(p.pushGate.handleDecline).toHaveBeenCalledOnce();
    expect(p.pushGate.handleAccept).not.toHaveBeenCalled(); expect(io.register).not.toHaveBeenCalled();
  });
});

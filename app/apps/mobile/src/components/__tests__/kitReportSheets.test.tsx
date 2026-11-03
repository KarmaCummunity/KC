// @vitest-environment jsdom
// Report, ban and donation-link forms on the kit `BottomSheet`, `TextField` and
// buttons (spec 17 §4.1.1, TD-243): each renders as a named dialog, submits the
// chosen reason and note, and dismisses. The ban confirm is a red `DangerButton` (D94).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { lightColors } from '@kc/ui';

vi.mock('react-native-reanimated', async () => (await import('../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('react-native-safe-area-context', async () => (await import('../ui/__tests__/kitDialogTestKit')).safeAreaDouble);
vi.mock('react-i18next', async () => (await import('../ui/__tests__/kitDialogTestKit')).i18nDouble);
vi.mock('@expo/vector-icons', async () => (await import('../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

const container = vi.hoisted(() => {
  const ok = () => vi.fn(() => Promise.resolve());
  return {
    reportPost: { execute: ok() },
    reportChat: { execute: ok() },
    reportListing: { execute: ok() },
    reportUser: { execute: ok() },
    banUser: { execute: ok() },
    addDonationLink: { execute: vi.fn(() => Promise.resolve({ id: 'l_new' })) },
    updateDonationLink: { execute: ok() },
  };
});
vi.mock('../../lib/container', () => ({ container }));
vi.mock('../../store/authStore', () => ({
  useAuthStore: (select: (state: { session: { userId: string } }) => unknown) => select({ session: { userId: 'u_me' } }),
}));
// Native confirm dialogs are out of scope: confirm straight away.
const adminActions = vi.hoisted(() => ({
  confirmAndRun: vi.fn((opts: { onConfirm: () => Promise<void>; onSuccess: () => void; onCancel?: () => void }) => {
    void opts.onConfirm().then(opts.onSuccess);
  }),
  showAdminToast: vi.fn(),
}));
vi.mock('../chat/system/adminActions', () => adminActions);

import { renderInTheme, rgb } from '../ui/__tests__/kitDialogTestKit';
import { ReportPostModal } from '../post/ReportPostModal';
import { ReportChatModal } from '../ReportChatModal';
import { ReportListingModal } from '../marketplace/ReportListingModal';
import { ReportUserModal } from '../profile/ReportUserModal';
import { BanUserModal } from '../profile/BanUserModal';
import { AddDonationLinkModal } from '../AddDonationLinkModal';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const background = (element: HTMLElement) => getComputedStyle(element).backgroundColor;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Picks a reason, types a note and returns the submit button. */
function fillReport(reasonName: string, noteLabel: string, submitName: string) {
  fireEvent.click(screen.getByRole('radio', { name: reasonName }));
  expect(screen.getByRole('radio', { name: reasonName }).getAttribute('aria-checked')).toBe('true');
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '  spam links  ' } });
  return screen.getByRole('button', { name: submitName });
}

describe('report sheets', () => {
  it('ReportPostModal files the chosen reason and the trimmed note, then closes', async () => {
    const onClose = vi.fn();
    renderInTheme(<ReportPostModal postId="p_1" visible onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'post.reportTitle' })).toBeTruthy();
    const submit = fillReport('post.reportReasonIllegal', 'post.reportNotePlaceholder', 'post.reportSubmit');
    expect(background(submit)).toBe(rgb(lightColors.primary));
    fireEvent.click(submit);
    await flush();
    expect(container.reportPost.execute).toHaveBeenCalledWith({
      reporterId: 'u_me',
      postId: 'p_1',
      reason: 'Illegal',
      note: 'spam links',
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ReportChatModal sends no note when it is left empty', async () => {
    renderInTheme(<ReportChatModal chatId="c_1" visible onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'post.reportSubmit' }));
    await flush();
    expect(container.reportChat.execute).toHaveBeenCalledWith({
      reporterId: 'u_me',
      chatId: 'c_1',
      reason: 'Spam',
      note: undefined,
    });
  });

  it('ReportListingModal submits and dismisses from cancel and the ✕', async () => {
    const onClose = vi.fn();
    renderInTheme(<ReportListingModal listingId="m_1" visible onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'general.close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(fillReport('post.reportReasonOther', 'post.reportNotePlaceholder', 'post.reportSubmit'));
    await flush();
    expect(container.reportListing.execute).toHaveBeenCalledWith(
      expect.objectContaining({ listingId: 'm_1', reason: 'Other', note: 'spam links' }),
    );
  });

  it('ReportUserModal labels its reasons and files a user report', async () => {
    renderInTheme(<ReportUserModal targetUserId="u_target" visible onClose={vi.fn()} />);
    expect(screen.getByRole('radiogroup', { name: 'moderation.report.user.reasonLabel' })).toBeTruthy();
    fireEvent.click(
      fillReport('moderation.reasons.offensive', 'moderation.report.user.noteLabel', 'moderation.report.user.submit'),
    );
    await flush();
    expect(container.reportUser.execute).toHaveBeenCalledWith(
      expect.objectContaining({ targetUserId: 'u_target', reason: 'Offensive', note: 'spam links' }),
    );
  });
});

describe('BanUserModal', () => {
  it('confirms the ban on a red DangerButton and closes after it succeeds', async () => {
    const onClose = vi.fn();
    renderInTheme(<BanUserModal targetUserId="u_target" visible onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'moderation.ban.title' })).toBeTruthy();
    const submit = fillReport('moderation.ban.reasons.harassment', 'moderation.ban.noteLabel', 'moderation.ban.submit');
    expect(background(submit)).toBe(rgb(lightColors.error));
    fireEvent.click(submit);
    await flush();
    expect(container.banUser.execute).toHaveBeenCalledWith({
      adminId: 'u_me',
      targetUserId: 'u_target',
      reason: 'harassment',
      note: 'spam links',
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(adminActions.showAdminToast).toHaveBeenCalledWith('moderation.actions.success.ban');
  });

  it('frees the sheet again when the admin cancels the confirmation (TD-251)', async () => {
    adminActions.confirmAndRun.mockImplementationOnce(({ onCancel }: { onCancel?: () => void }) => onCancel?.());
    const onClose = vi.fn();
    renderInTheme(<BanUserModal targetUserId="u_target" visible onClose={onClose} />);
    fireEvent.click(fillReport('moderation.ban.reasons.spam', 'moderation.ban.noteLabel', 'moderation.ban.submit'));
    await flush();
    expect(adminActions.confirmAndRun).toHaveBeenCalledTimes(1);
    expect(container.banUser.execute).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    const submit = screen.getByRole('button', { name: 'moderation.ban.submit' });
    expect(submit.getAttribute('aria-disabled')).not.toBe('true');
    const cancel = screen.getByRole('button', { name: 'moderation.actions.cancel' });
    expect(cancel.getAttribute('aria-disabled')).not.toBe('true');
    // Not busy any more: a second submit asks for confirmation again.
    fireEvent.click(submit);
    await flush();
    expect(adminActions.confirmAndRun).toHaveBeenCalledTimes(2);
  });

  it('dismisses from the cancel button', () => {
    const onClose = vi.fn();
    renderInTheme(<BanUserModal targetUserId="u_target" visible onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'moderation.actions.cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(adminActions.confirmAndRun).not.toHaveBeenCalled();
  });
});

describe('AddDonationLinkModal', () => {
  function renderForm() {
    const handlers = { onClose: vi.fn(), onAdded: vi.fn(), onUpdated: vi.fn() };
    renderInTheme(<AddDonationLinkModal visible categorySlug="food" editingLink={null} {...handlers} />);
    return handlers;
  }

  it('keeps submit disabled until the form is valid, then adds the link', async () => {
    const { onAdded, onClose } = renderForm();
    expect(screen.getByRole('dialog', { name: 'donations.addLinkModal.title' })).toBeTruthy();
    const submit = screen.getByRole('button', { name: 'donations.addLinkModal.submit' });
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(screen.getByLabelText('donations.addLinkModal.urlLabel'), {
      target: { value: 'https://example.org' },
    });
    fireEvent.change(screen.getByLabelText('donations.addLinkModal.nameLabel'), { target: { value: 'Food bank' } });
    expect(submit.getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(submit);
    await flush();
    expect(container.addDonationLink.execute).toHaveBeenCalledWith(
      expect.objectContaining({ categorySlug: 'food', url: 'https://example.org', displayName: 'Food bank' }),
    );
    expect(onAdded).toHaveBeenCalledWith({ id: 'l_new' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses from the cancel button', () => {
    const { onClose } = renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'donations.addLinkModal.cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom
// Action menus and the guest join prompt on the kit `BottomSheet` (spec 17 §4.1.1,
// TD-243): each renders its rows, runs the picked action, and dismisses from the
// footer cancel and the ✕. Destructive rows are tinted `error`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { lightColors } from '@kc/ui';
import type { DonationLink } from '@kc/domain';

vi.mock('react-native-reanimated', async () => (await import('../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('react-native-safe-area-context', async () => (await import('../ui/__tests__/kitDialogTestKit')).safeAreaDouble);
vi.mock('react-i18next', async () => (await import('../ui/__tests__/kitDialogTestKit')).i18nDouble);
vi.mock('@expo/vector-icons', async () => (await import('../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('expo-router', () => ({ useRouter: () => router }));
const block = vi.hoisted(() => ({ canBlock: true, isBlocked: false, busy: false, toggle: vi.fn() }));
vi.mock('../../hooks/useUserBlock', () => ({ useUserBlock: () => block }));
const adminRoles = vi.hoisted(() => ({ roles: [] as string[] }));
vi.mock('../../hooks/useAdminRoles', () => ({ useAdminRoles: () => adminRoles }));
// The sheets these menus open are covered in kitReportSheets.test.tsx.
vi.mock('../profile/ReportUserModal', () => ({
  ReportUserModal: ({ visible }: { visible: boolean }) => (visible ? <span>report-user-sheet</span> : null),
}));
vi.mock('../profile/BanUserModal', () => ({
  BanUserModal: ({ visible }: { visible: boolean }) => (visible ? <span>ban-user-sheet</span> : null),
}));
const linkHandlers = vi.hoisted(() => ({
  openDonationLinkUrl: vi.fn(),
  reportDonationLink: vi.fn(),
  confirmRemoveDonationLink: vi.fn(),
}));
vi.mock('../donationLinkRowHandlers', () => linkHandlers);

import { finishModalAnimation, renderInTheme, rgb } from '../ui/__tests__/kitDialogTestKit';
import { ChatActionMenu } from '../ChatActionMenu';
import { DonationLinkRowMenu } from '../DonationLinkRowMenu';
import { GuestJoinModal } from '../GuestJoinModal';
import { MyProfileOverflowMenu } from '../profile/MyProfileOverflowMenu';
import { ProfileOverflowMenu } from '../profile/ProfileOverflowMenu';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Object.assign(block, { canBlock: true, isBlocked: false, busy: false });
  adminRoles.roles = [];
});

const textColor = (name: string) => getComputedStyle(screen.getByText(name)).color;

describe('ChatActionMenu', () => {
  function renderMenu(withDelete = true) {
    const handlers = { onClose: vi.fn(), onReport: vi.fn(), onDeleteFromInbox: vi.fn() };
    renderInTheme(
      <ChatActionMenu
        visible
        onClose={handlers.onClose}
        onReport={handlers.onReport}
        deleteLabel={withDelete ? 'Delete chat' : undefined}
        onDeleteFromInbox={withDelete ? handlers.onDeleteFromInbox : undefined}
      />,
    );
    return handlers;
  }

  it('reports, and deletes from the inbox in red after closing', () => {
    const { onClose, onReport, onDeleteFromInbox } = renderMenu();
    expect(textColor('Delete chat')).toBe(rgb(lightColors.error));
    fireEvent.click(screen.getByRole('button', { name: 'chat.menuReport' }));
    expect(onReport).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Delete chat' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDeleteFromInbox).toHaveBeenCalledTimes(1);
  });

  it('hides the delete row without a label and dismisses from cancel and the ✕', () => {
    const { onClose } = renderMenu(false);
    expect(screen.queryByRole('button', { name: 'Delete chat' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'general.cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'general.close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('DonationLinkRowMenu', () => {
  const LINK = { id: 'l_1', submittedBy: 'u_owner', url: 'https://example.org' } as unknown as DonationLink;

  function renderMenu(me: string | null, isSuperAdmin = false) {
    const handlers = { onClose: vi.fn(), onRemoved: vi.fn(), onEdit: vi.fn() };
    renderInTheme(<DonationLinkRowMenu visible link={LINK} me={me} isSuperAdmin={isSuperAdmin} {...handlers} />);
    return handlers;
  }

  it('lets the submitter open, edit and remove (red) the link', () => {
    const { onClose, onEdit } = renderMenu('u_owner');
    fireEvent.click(screen.getByRole('button', { name: 'donations.links.rowMenu.open' }));
    expect(linkHandlers.openDonationLinkUrl).toHaveBeenCalledWith(LINK);
    fireEvent.click(screen.getByRole('button', { name: 'donations.links.rowMenu.edit' }));
    expect(onEdit).toHaveBeenCalledWith(LINK);
    expect(textColor('donations.links.rowMenu.remove')).toBe(rgb(lightColors.error));
    fireEvent.click(screen.getByRole('button', { name: 'donations.links.rowMenu.remove' }));
    expect(linkHandlers.confirmRemoveDonationLink).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('offers a visitor only open and report, and dismisses from cancel', () => {
    const { onClose } = renderMenu('u_visitor');
    expect(screen.queryByRole('button', { name: 'donations.links.rowMenu.edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'donations.links.rowMenu.remove' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'donations.links.rowMenu.report' }));
    expect(linkHandlers.reportDonationLink).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'donations.addLinkModal.cancel' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

/** Opens a profile overflow menu from its ⋮ trigger. */
function openMenu(triggerName: string) {
  fireEvent.click(screen.getByRole('button', { name: triggerName }));
  finishModalAnimation();
}

describe('MyProfileOverflowMenu', () => {
  it('navigates from a row and closes', () => {
    renderInTheme(<MyProfileOverflowMenu showFollowRequests={false} />);
    openMenu('profile.myProfileMenuA11y');
    expect(screen.queryByRole('button', { name: 'settings.followRequests' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'settings.stats' }));
    expect(router.push).toHaveBeenCalledWith('/stats');
    finishModalAnimation();
    expect(screen.queryByRole('button', { name: 'settings.stats' })).toBeNull();
  });

  it('shows follow requests for a private profile and dismisses from cancel', () => {
    renderInTheme(<MyProfileOverflowMenu showFollowRequests />);
    openMenu('profile.myProfileMenuA11y');
    expect(screen.getByRole('button', { name: 'settings.followRequests' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'general.cancel' }));
    finishModalAnimation();
    expect(screen.queryByRole('button', { name: 'settings.followRequests' })).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('ProfileOverflowMenu', () => {
  it('opens the report sheet from the report row', () => {
    renderInTheme(<ProfileOverflowMenu targetUserId="u_target" />);
    openMenu('moderation.report.user.title');
    fireEvent.click(screen.getAllByRole('button', { name: 'moderation.report.user.title' })[1]);
    expect(screen.getByText('report-user-sheet')).toBeTruthy();
  });

  it('blocks in red from the block row, keeping its test ID', () => {
    renderInTheme(<ProfileOverflowMenu targetUserId="u_target" />);
    openMenu('moderation.report.user.title');
    const blockRow = screen.getByTestId('profile-block-toggle');
    expect(textColor('moderation.block.block')).toBe(rgb(lightColors.error));
    fireEvent.click(blockRow);
    expect(block.toggle).toHaveBeenCalledTimes(1);
  });

  it('shows unblock in the neutral colour and disables the row while busy', () => {
    Object.assign(block, { isBlocked: true, busy: true });
    renderInTheme(<ProfileOverflowMenu targetUserId="u_target" />);
    openMenu('moderation.report.user.title');
    expect(textColor('moderation.block.unblock')).toBe(rgb(lightColors.textPrimary));
    fireEvent.click(screen.getByTestId('profile-block-toggle'));
    expect(block.toggle).not.toHaveBeenCalled();
  });

  it('offers ban only to a super admin, and opens the ban sheet', () => {
    renderInTheme(<ProfileOverflowMenu targetUserId="u_target" />);
    openMenu('moderation.report.user.title');
    expect(screen.queryByRole('button', { name: 'moderation.actions.ban' })).toBeNull();
    cleanup();
    adminRoles.roles = ['super_admin'];
    renderInTheme(<ProfileOverflowMenu targetUserId="u_target" />);
    openMenu('moderation.report.user.title');
    fireEvent.click(screen.getByRole('button', { name: 'moderation.actions.ban' }));
    expect(screen.getByText('ban-user-sheet')).toBeTruthy();
  });
});

describe('GuestJoinModal', () => {
  function renderPrompt() {
    const handlers = { onJoin: vi.fn(), onDismiss: vi.fn() };
    renderInTheme(<GuestJoinModal visible message="Join to like posts" joinLabel="Join now" {...handlers} />);
    return handlers;
  }

  it('shows the message and joins from the primary button', () => {
    const { onJoin } = renderPrompt();
    expect(screen.getByText('Join to like posts')).toBeTruthy();
    const join = screen.getByRole('button', { name: 'Join now' });
    expect(getComputedStyle(join).backgroundColor).toBe(rgb(lightColors.primary));
    fireEvent.click(join);
    expect(onJoin).toHaveBeenCalledTimes(1);
  });

  it('dismisses from the close button, the ✕ and Escape', () => {
    const { onDismiss } = renderPrompt();
    for (const close of screen.getAllByRole('button', { name: 'general.close' })) fireEvent.click(close);
    fireEvent.keyUp(document, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(3);
  });
});

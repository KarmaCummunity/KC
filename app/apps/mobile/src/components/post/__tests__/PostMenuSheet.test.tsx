// @vitest-environment jsdom
// PostMenuSheet on the kit `BottomSheet` (FR-POST-014 / 015, FR-ADMIN-006 / 009,
// spec 17 §4.1.1, TD-243): the role-specific actions render, and the sheet
// dismisses through `onClose`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';
import type { PostWithOwner } from '@kc/application';

vi.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../../../hooks/useModalHardwareBack', () => ({ useModalHardwareBack: () => {} }));
vi.mock('../../../lib/container', () => ({
  container: { socialFeed: { hidePost: () => Promise.resolve(), addMuteFilter: () => Promise.resolve() } },
}));
vi.mock('../../../lib/haptics', () => ({ hapticLightTap: () => {} }));
vi.mock('../../../hooks/usePostMenuActions', () => ({
  usePostMenuActions: () => ({
    busy: false,
    error: null,
    clearError: () => {},
    handleOwnerDelete: () => {},
    handleAdminRemove: () => {},
  }),
}));
vi.mock('../../../hooks/usePostShare', () => ({ usePostShare: () => ({ canShare: true, share: () => {}, busy: false }) }));
vi.mock('../../../hooks/usePostActorPrivacyModel', () => ({ shouldShowPostExposureControls: () => false }));
// Sibling overlays opened from the menu are covered by their own tests.
vi.mock('../ConfirmActionModal', () => ({ ConfirmActionModal: () => null }));
vi.mock('../ReportPostModal', () => ({ ReportPostModal: () => null }));
vi.mock('../PostMenuExposureBlock', () => ({ PostMenuExposureBlock: () => null }));

import { PostMenuSheet } from '../PostMenuSheet';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const POST = { postId: 'p_1', ownerId: 'u_owner', status: 'open', title: 'Sofa' } as unknown as PostWithOwner;

function renderMenu(viewerId: string | null, overrides: { visible?: boolean; isSuperAdmin?: boolean } = {}) {
  const handlers = { onClose: vi.fn(), onToggleSave: vi.fn(), onAfterRemoval: vi.fn(), onEdit: vi.fn() };
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <PostMenuSheet
          visible={overrides.visible ?? true}
          post={POST}
          viewerId={viewerId}
          isSuperAdmin={overrides.isSuperAdmin ?? false}
          isSaved={false}
          saveBusy={false}
          {...handlers}
        />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...view, ...handlers };
}

describe('PostMenuSheet', () => {
  it('shows a viewer share, hide, mute, report and save', () => {
    const { getByRole, queryByRole } = renderMenu('u_viewer');
    for (const name of ['post.menuShare', 'post.menuHideFromFeed', 'feedSettings.menuMuteUser', 'post.report', 'post.menuSave']) {
      expect(getByRole('button', { name })).toBeTruthy();
    }
    expect(queryByRole('button', { name: 'post.menuDelete' })).toBeNull();
  });

  it('shows the owner edit and delete instead of report', () => {
    const { getByRole, queryByRole } = renderMenu('u_owner');
    expect(getByRole('button', { name: 'post.menuEdit' })).toBeTruthy();
    expect(getByRole('button', { name: 'post.menuDelete' })).toBeTruthy();
    expect(queryByRole('button', { name: 'post.report' })).toBeNull();
  });

  it('renders nothing while closed', () => {
    const { queryByRole } = renderMenu('u_viewer', { visible: false });
    expect(queryByRole('button', { name: 'post.menuSave' })).toBeNull();
  });

  it('saves, then closes', () => {
    const { getByRole, onToggleSave, onClose } = renderMenu('u_viewer');
    fireEvent.click(getByRole('button', { name: 'post.menuSave' }));
    expect(onToggleSave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses through onClose from the close control', () => {
    const { getByRole, onClose } = renderMenu('u_viewer');
    fireEvent.click(getByRole('button', { name: 'general.close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom
// FR-ORG (G18) — adding an organization member: the roles offered follow the viewer's own role,
// and a server refusal shows its copy under the handle field.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
import { OrgError } from '@kc/domain';

vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
vi.mock('../../../lib/haptics', () => ({ hapticLightImpact: () => undefined, hapticSuccess: vi.fn() }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { OrgAddMemberCard } from '../OrgAddMemberCard';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderCard = (props: React.ComponentProps<typeof OrgAddMemberCard>) =>
  render(<ThemeProvider><OrgAddMemberCard {...props} /></ThemeProvider>);

describe('OrgAddMemberCard', () => {
  it('offers an admin every role and a manager only staff and volunteer roles', () => {
    const admin = renderCard({ myRole: 'org_admin', busy: false, onAdd: vi.fn() });
    expect(admin.queryByTestId('org-add-member-role-org_admin')).not.toBeNull();
    cleanup();
    const manager = renderCard({ myRole: 'org_manager', busy: false, onAdd: vi.fn() });
    expect(manager.queryByTestId('org-add-member-role-org_admin')).toBeNull();
    expect(manager.queryByTestId('org-add-member-role-org_manager')).toBeNull();
    expect(manager.queryByTestId('org-add-member-role-org_employee')).not.toBeNull();
  });

  it('adds the typed handle with the chosen role', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const view = renderCard({ myRole: 'org_admin', busy: false, onAdd });
    fireEvent.change(view.getByTestId('org-add-member-handle'), { target: { value: '@dana' } });
    fireEvent.click(view.getByTestId('org-add-member-role-org_employee'));
    fireEvent.click(view.getByTestId('org-add-member-submit'));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('@dana', 'org_employee'));
  });

  it('shows the server refusal', async () => {
    const onAdd = vi.fn().mockRejectedValue(new OrgError('org_member_user_not_found'));
    const view = renderCard({ myRole: 'org_admin', busy: false, onAdd });
    fireEvent.change(view.getByTestId('org-add-member-handle'), { target: { value: 'nobody' } });
    fireEvent.click(view.getByTestId('org-add-member-submit'));
    await waitFor(() => expect(view.getByText('organizations.errors.org_member_user_not_found')).toBeTruthy());
  });
});

// @vitest-environment jsdom
// Admin sections and their availability switches (src/lib/parkedFeatures.ts): the back-office
// tools (migrations 0021–0023) render their screens; the WhatsApp console, still parked, renders
// the "not available yet" notice so a direct link never fires a refused call.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';

vi.mock('expo-router', () => ({
  Slot: () => <span data-testid="slot" />,
  Stack: () => <span data-testid="stack" />,
  usePathname: () => '/admin/tasks',
}));
vi.mock('../RouteErrorBoundary', () => ({ RouteErrorBoundary: () => null }));
vi.mock('../ParkedFeatureNotice', () => ({
  ParkedFeatureNotice: ({ testID }: { testID?: string }) => <span data-testid={testID} />,
}));
vi.mock('../admin/useAdminScreenTitle', () => ({ useAdminScreenTitle: () => undefined }));
vi.mock('../../i18n/useLocaleBundle', () => ({
  useLocaleBundle: () => ({ admin: { tasks: { title: 'tasks', newBtn: 'new' } } }),
}));

import AdminTasksLayout from '../../../app/(admin)/tasks/_layout';
import AdminCrmLayout from '../../../app/(admin)/crm/_layout';
import AdminTimeLayout from '../../../app/(admin)/time/_layout';
import AdminWhatsAppLayout from '../../../app/(admin)/whatsapp/_layout';

afterEach(cleanup);

function renderLayout(Layout: () => React.ReactElement) {
  return render(<Layout />);
}

describe('back-office sections (FR-ADMIN-018, FR-ADMIN-032, FR-ADMIN-033)', () => {
  it.each([
    ['tasks', AdminTasksLayout, 'admin-tasks-parked', 'stack'],
    ['crm', AdminCrmLayout, 'admin-crm-parked', 'slot'],
    ['time', AdminTimeLayout, 'admin-time-parked', 'slot'],
  ] as const)('the %s section renders its screens, not the not-available notice', (_name, Layout, parkedId, screenId) => {
    const { getByTestId, queryByTestId } = renderLayout(Layout);
    expect(getByTestId(screenId)).toBeTruthy();
    expect(queryByTestId(parkedId)).toBeNull();
  });
});

describe('parked WhatsApp console (M22)', () => {
  it('shows the not-available notice, not the console', () => {
    const { getByTestId, queryByTestId } = renderLayout(AdminWhatsAppLayout);
    expect(getByTestId('admin-whatsapp-parked')).toBeTruthy();
    expect(queryByTestId('slot')).toBeNull();
  });
});

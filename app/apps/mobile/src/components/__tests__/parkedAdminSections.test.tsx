// @vitest-environment jsdom
// The admin sections whose backend is parked (src/lib/parkedFeatures.ts) render the "not
// available yet" notice instead of their screens, so a direct link never fires a refused call.
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

describe('parked back-office sections (M19)', () => {
  it.each([
    ['tasks', AdminTasksLayout, 'admin-tasks-parked'],
    ['crm', AdminCrmLayout, 'admin-crm-parked'],
    ['time', AdminTimeLayout, 'admin-time-parked'],
  ] as const)('the %s section shows the not-available notice, not its screens', (_name, Layout, testId) => {
    const { getByTestId, queryByTestId } = renderLayout(Layout);
    expect(getByTestId(testId)).toBeTruthy();
    expect(queryByTestId('slot')).toBeNull();
    expect(queryByTestId('stack')).toBeNull();
  });
});

describe('parked WhatsApp console (M22)', () => {
  it('shows the not-available notice, not the console', () => {
    const { getByTestId, queryByTestId } = renderLayout(AdminWhatsAppLayout);
    expect(getByTestId('admin-whatsapp-parked')).toBeTruthy();
    expect(queryByTestId('slot')).toBeNull();
  });
});

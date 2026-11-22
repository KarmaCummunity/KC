// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
const io = vi.hoisted(() => ({ status: 'askable', enable: vi.fn(), register: vi.fn() }));
vi.mock('react-native', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-native')>()), Platform: { OS: 'ios', select: (p: { ios?: unknown; default?: unknown }) => p.ios ?? p.default } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
vi.mock('expo-notifications', () => ({ getPermissionsAsync: async () => ({ status: 'undetermined' }) }));
vi.mock('@kc/ui', async () => ({ Text: 'span', makeUseStyles: () => () => ({}), typography: {}, spacing: {}, radius: {} }));
vi.mock('../../navigation/shellStackScreenOptions', () => ({ useShellStackScreenOptions: () => ({}) }));
vi.mock('../../components/RouteErrorBoundary', () => ({ RouteErrorBoundary: () => null }));
vi.mock('../../components/NotificationToggleRow', () => ({ NotificationToggleRow: () => null }));
vi.mock('../../components/settings/QuietHoursSection', () => ({ QuietHoursSection: () => null }));
vi.mock('../../hooks/useNotificationPreferences', () => ({ useNotificationPreferences: () => ({ prefs: { kinds: {} }, update: vi.fn() }) }));
vi.mock('../../lib/notifications/useDevicePushPermission', () => ({ useDevicePushPermission: () => ({ status: io.status, busy: false, enable: io.enable }) }));
vi.mock('../../lib/notifications/register', () => ({ registerCurrentDeviceIfPermitted: io.register }));
vi.mock('../../store/authStore', () => ({ useAuthStore: (select: (s: unknown) => unknown) => select({ session: { userId: 'member' } }) }));
vi.mock('../../lib/container', () => ({ container: { deviceRepo: {} } }));
import NotificationSettings from '../../../app/settings/notifications';
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('notification settings permission row', () => {
  it('does not label an unrequested permission blocked and offers an explicit enable action', () => {
    io.status = 'askable'; render(<NotificationSettings />);
    expect(screen.getByText('notifications.permissionNotRequested')).toBeTruthy();
    expect(screen.queryByText('notifications.permissionDenied')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'notifications.permissionEnable' }));
    expect(io.enable).toHaveBeenCalledOnce();
  });
  it('offers Settings only for blocked permission, retry for errors, and no action while loading or granted', () => {
    io.status = 'blocked'; const { rerender } = render(<NotificationSettings />);
    expect(screen.getByRole('button', { name: 'notifications.openOsSettings' })).toBeTruthy();
    io.status = 'error'; rerender(<NotificationSettings />);
    expect(screen.getByRole('button', { name: 'notifications.permissionRetry' })).toBeTruthy();
    for (const status of ['loading', 'granted']) {
      io.status = status; rerender(<NotificationSettings />); expect(screen.queryByRole('button')).toBeNull();
    }
  });
});

// Team / admins section — roster vs. person screen title in the TopBar.
import { useMemo } from 'react';
import { Stack, usePathname } from 'expo-router';
import { useLocaleBundle } from '../../../src/i18n/useLocaleBundle';
import { useAdminScreenTitle } from '../../../src/components/admin/useAdminScreenTitle';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

export default function AdminAdminsLayout() {
  const L = useLocaleBundle();
  const pathname = usePathname() ?? '';

  const title = useMemo(() => {
    if (pathname.includes('/admins/') && !pathname.endsWith('/admins')) {
      return L.admin.admins.detail.title;
    }
    return L.admin.nav.admins;
  }, [L, pathname]);

  useAdminScreenTitle(title);

  return <Stack screenOptions={{ headerShown: false }} />;
}

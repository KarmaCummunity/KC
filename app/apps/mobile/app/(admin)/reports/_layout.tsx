// Reports admin section — inbox vs. case detail titles in the TopBar.
import { useMemo } from 'react';
import { Stack, usePathname } from 'expo-router';
import { useLocaleBundle } from '../../../src/i18n/useLocaleBundle';
import { useAdminScreenTitle } from '../../../src/components/admin/useAdminScreenTitle';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

export default function AdminReportsLayout() {
  const L = useLocaleBundle();
  const pathname = usePathname() ?? '';

  const title = useMemo(() => {
    if (pathname.includes('/reports/') && !pathname.endsWith('/reports')) {
      return L.admin.caseDetail.title;
    }
    return L.admin.reports.inboxTitle;
  }, [L, pathname]);

  useAdminScreenTitle(title);

  return <Stack screenOptions={{ headerShown: false }} />;
}

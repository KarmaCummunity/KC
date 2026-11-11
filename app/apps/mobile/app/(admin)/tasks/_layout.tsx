// Tasks admin section — TopBar title for list, create, and detail routes. Parked: the
// production baseline has no task tracker (M19), so every route of the section shows the
// "not available yet" state instead (src/lib/parkedFeatures.ts).
import { useMemo } from 'react';
import { Stack, usePathname } from 'expo-router';
import { useLocaleBundle } from '../../../src/i18n/useLocaleBundle';
import { useAdminScreenTitle } from '../../../src/components/admin/useAdminScreenTitle';
import { ParkedFeatureNotice } from '../../../src/components/ParkedFeatureNotice';
import { BACK_OFFICE_TOOLS_AVAILABLE } from '../../../src/lib/parkedFeatures';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

export default function AdminTasksLayout() {
  const L = useLocaleBundle();
  const pathname = usePathname() ?? '';

  const title = useMemo(() => {
    if (pathname.includes('/tasks/new')) return L.admin.tasks.newBtn;
    if (/\/tasks\//.test(pathname) && !pathname.endsWith('/tasks') && !pathname.includes('/new')) {
      return L.admin.tasks.title;
    }
    return L.admin.tasks.title;
  }, [L, pathname]);

  useAdminScreenTitle(title);

  if (!BACK_OFFICE_TOOLS_AVAILABLE) return <ParkedFeatureNotice testID="admin-tasks-parked" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}

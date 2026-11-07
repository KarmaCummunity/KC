// Tasks admin section — TopBar title for list, create, and detail routes.
import { useMemo } from 'react';
import { Stack, usePathname } from 'expo-router';
import { useLocaleBundle } from '../../../src/i18n/useLocaleBundle';
import { useAdminScreenTitle } from '../../../src/components/admin/useAdminScreenTitle';

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

  return <Stack screenOptions={{ headerShown: false }} />;
}

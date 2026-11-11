// Money admin section — TopBar title follows the active sub-screen (ledger, accounts, …).
import { useMemo } from 'react';
import { Stack, usePathname } from 'expo-router';
import { useLocaleBundle } from '../../../src/i18n/useLocaleBundle';
import { useAdminScreenTitle } from '../../../src/components/admin/useAdminScreenTitle';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

export default function AdminMoneyLayout() {
  const L = useLocaleBundle().admin.money;
  const pathname = usePathname() ?? '';

  const title = useMemo(() => {
    if (pathname.includes('/money/accounts')) return L.accounts.title;
    if (pathname.includes('/money/donors')) return L.donors.title;
    if (pathname.includes('/money/visibility')) return L.visibility.title;
    return L.title;
  }, [L, pathname]);

  useAdminScreenTitle(title);

  return <Stack screenOptions={{ headerShown: false }} />;
}

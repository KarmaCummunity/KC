// FR-ADMIN-011 AC6 — the global TopBar stays visible inside the admin portal.
import { View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { makeUseStyles } from '@kc/ui';
import { useAdminPortalChromeState } from './AdminPortalChrome';
import { TopBarStackHeader } from '../../navigation/TopBarStackHeader';

function isAdminDashboardPath(pathname: string): boolean {
  if (!pathname) return true;
  if (pathname === '/admin' || pathname === '/(admin)') return true;
  return /\/admin\/?$/.test(pathname);
}

export function AdminPortalTopBar() {
  const styles = useStyles();
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const chrome = useAdminPortalChromeState();
  const showBack = !isAdminDashboardPath(pathname) && router.canGoBack();

  return (
    <View style={styles.pin} testID="admin-portal-topbar">
      <TopBarStackHeader title={chrome.title} showBack={showBack} right={chrome.headerRight} />
      {chrome.filterStrip ?? null}
    </View>
  );
}

const useStyles = makeUseStyles(() => ({
  pin: { flexShrink: 0, alignSelf: 'stretch', width: '100%' },
}));

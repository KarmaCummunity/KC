// FR-DONATE-003 AC7 (#1800): the in-app verified-nonprofit payment flow runs on a sandbox provider
// and is hidden behind `money_in_app_org_payments`. The Money hub hides its entry points; this gate
// covers the screens themselves, so a direct or shared link with the flag off lands on the hub.
import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';

export function InAppOrgPaymentsGate({ children }: { readonly children: ReactNode }) {
  const enabled = useFeatureFlag('money_in_app_org_payments');
  if (!enabled) return <Redirect href="/(tabs)/donations/money" />;
  return <>{children}</>;
}

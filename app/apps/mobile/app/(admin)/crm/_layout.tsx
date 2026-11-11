// CRM contacts admin section (V2-ADMIN-CRM-8). Parked: the production baseline has no CRM (M19), so
// a direct link shows the "not available yet" state instead of the screen
// (src/lib/parkedFeatures.ts).
import { Slot } from 'expo-router';
import { ParkedFeatureNotice } from '../../../src/components/ParkedFeatureNotice';
import { BACK_OFFICE_TOOLS_AVAILABLE } from '../../../src/lib/parkedFeatures';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

export default function AdminCrmLayout() {
  return BACK_OFFICE_TOOLS_AVAILABLE ? <Slot /> : <ParkedFeatureNotice testID="admin-crm-parked" />;
}

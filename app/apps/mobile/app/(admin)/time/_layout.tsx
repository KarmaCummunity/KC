// Timesheets admin section (FR-ADMIN-033). While the switch in src/lib/parkedFeatures.ts is off,
// a direct link shows the "not available yet" state instead of the screen.
import { Slot } from 'expo-router';
import { ParkedFeatureNotice } from '../../../src/components/ParkedFeatureNotice';
import { TIMESHEETS_AVAILABLE } from '../../../src/lib/parkedFeatures';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

export default function AdminTimeLayout() {
  return TIMESHEETS_AVAILABLE ? <Slot /> : <ParkedFeatureNotice testID="admin-time-parked" />;
}

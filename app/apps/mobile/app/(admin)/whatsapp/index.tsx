// WhatsApp bot ops dashboard (#939). The screen lives in src/screens/admin; this route is hidden
// while the `whatsappBot` launch surface is off (config/launchSurfaces.ts).
import { LaunchSurfaceGate } from '../../../src/components/LaunchSurfaceGate';
import { WhatsAppAdminScreen } from '../../../src/screens/admin/WhatsAppAdminScreen';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

export default function WhatsAppAdminRoute() {
  return (
    <LaunchSurfaceGate surface="whatsappBot" redirectTo="/(admin)">
      <WhatsAppAdminScreen />
    </LaunchSurfaceGate>
  );
}

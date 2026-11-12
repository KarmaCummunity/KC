// WhatsApp console admin section (#1090). Parked: the WhatsApp bot waits for the integrations
// module (M22), so a direct link shows the "not available yet" state instead of the screen
// (src/lib/parkedFeatures.ts).
import { Slot } from 'expo-router';
import { ParkedFeatureNotice } from '../../../src/components/ParkedFeatureNotice';
import { WHATSAPP_BOT_AVAILABLE } from '../../../src/lib/parkedFeatures';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

export default function AdminWhatsAppLayout() {
  return WHATSAPP_BOT_AVAILABLE ? <Slot /> : <ParkedFeatureNotice testID="admin-whatsapp-parked" />;
}

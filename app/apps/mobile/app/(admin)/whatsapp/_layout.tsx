// WhatsApp console admin section (#939). The availability switch (src/lib/parkedFeatures.ts) is on
// now that the integrations module ships (M22); off, a direct link shows the "not available yet" state.
import { Slot } from 'expo-router';
import { ParkedFeatureNotice } from '../../../src/components/ParkedFeatureNotice';
import { WHATSAPP_BOT_AVAILABLE } from '../../../src/lib/parkedFeatures';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

export default function AdminWhatsAppLayout() {
  return WHATSAPP_BOT_AVAILABLE ? <Slot /> : <ParkedFeatureNotice testID="admin-whatsapp-parked" />;
}

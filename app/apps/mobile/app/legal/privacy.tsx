import { LegalDocumentReader } from '../../src/components/legal/LegalDocumentReader';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

export default function PrivacyScreen() {
  return <LegalDocumentReader docType="privacy" />;
}

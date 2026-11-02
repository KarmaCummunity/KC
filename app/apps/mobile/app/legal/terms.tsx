import { LegalDocumentReader } from '../../src/components/legal/LegalDocumentReader';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

export default function TermsScreen() {
  return <LegalDocumentReader docType="terms" />;
}

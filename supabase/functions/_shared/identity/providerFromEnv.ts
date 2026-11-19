// _shared/identity/providerFromEnv.ts — the configured identity provider (FR-VERIFY-010 AC3).
//
// Secrets, by name only: IDV_PROVIDER_API_KEY, IDV_WEBHOOK_SECRET. Configuration (not secret):
// IDV_PROVIDER (default `didit`), IDV_DIDIT_WORKFLOW_ID, IDV_CALLBACK_URL (optional).
// kc-dev points these at the provider's sandbox application.

import { readEnv } from '../readEnv.ts';
import { DIDIT_SLUG, diditProvider } from './didit.ts';
import type { IdentityProvider } from './provider.ts';

export function providerFromEnv(): IdentityProvider {
  const slug = readEnv('IDV_PROVIDER', DIDIT_SLUG);
  if (slug !== DIDIT_SLUG) throw new Error(`unsupported identity provider: ${slug}`);
  return diditProvider({
    apiKey: readEnv('IDV_PROVIDER_API_KEY'),
    webhookSecret: readEnv('IDV_WEBHOOK_SECRET'),
    workflowId: readEnv('IDV_DIDIT_WORKFLOW_ID'),
    callbackUrl: readEnv('IDV_CALLBACK_URL') || undefined,
  });
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  LegalDocType,
  LegalDocumentContent,
  LegalPendingItem,
  LegalSeverity,
  LegalBlockMode,
} from '@kc/domain';
import type {
  AcceptLegalDocumentInput,
  AcceptLegalDocumentResult,
  ILegalDocumentRepository,
} from '@kc/application';
import { LegalConsentError } from '@kc/application';
import { fetchBootstrapSession, type BootstrapLegalDocument } from '../auth/bootstrapSession';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { mapRuleErrors } from '../auth/ruleErrors';
import { LegalDocumentCache } from './legalCache';

type VersionRow = Pick<
  Database['public']['Tables']['legal_document_versions']['Row'],
  | 'doc_type'
  | 'version'
  | 'effective_date'
  | 'body_md'
  | 'content_hash'
  | 'severity'
  | 'change_summary'
  | 'published_at'
>;

/** Stable refusals of `accept_legal_document` → consent error codes. */
const CONSENT_CODES = {
  legal_version_out_of_range: 'version_out_of_range',
  unknown_legal_document: 'unknown_document',
} as const;

function mapVersionRow(row: VersionRow): LegalDocumentContent {
  return {
    docType: row.doc_type as LegalDocType,
    version: row.version,
    effectiveDate: new Date(row.effective_date),
    bodyMd: row.body_md,
    contentHash: row.content_hash,
    severity: row.severity as LegalSeverity,
    changeSummary: row.change_summary,
    publishedAt: new Date(row.published_at),
  };
}

function mapPendingDocument(doc: BootstrapLegalDocument): LegalPendingItem {
  return {
    docType: doc.docType as LegalDocType,
    currentVersion: doc.currentVersion,
    currentEffectiveDate: new Date(doc.currentEffectiveDate),
    lastAcceptedVersion: doc.lastAcceptedVersion,
    severity: (doc.lastMaterialSeverity ?? 'standard') as LegalSeverity,
    blockMode: doc.blockMode as LegalBlockMode,
  };
}

export class SupabaseLegalDocumentRepository implements ILegalDocumentRepository {
  constructor(
    private readonly client: SupabaseClient<Database>,
    private readonly cache: LegalDocumentCache,
  ) {}

  async getCurrentContent(docType: LegalDocType): Promise<LegalDocumentContent> {
    try {
      const ptr = await this.client
        .from('legal_documents')
        .select('current_version')
        .eq('doc_type', docType)
        .single();

      if (ptr.error || !ptr.data) {
        return await this.fallbackToCacheOrThrow(docType, ptr.error?.message ?? 'no pointer row');
      }

      const versionQ = await this.client
        .from('legal_document_versions')
        .select('doc_type, version, effective_date, body_md, content_hash, severity, change_summary, published_at')
        .eq('doc_type', docType)
        .eq('version', ptr.data.current_version)
        .single();

      if (versionQ.error || !versionQ.data) {
        return await this.fallbackToCacheOrThrow(docType, versionQ.error?.message ?? 'no version row');
      }

      const fresh = mapVersionRow(versionQ.data);
      await this.cache.write(fresh);
      return fresh;
    } catch (err) {
      return this.fallbackToCacheOrThrow(docType, (err as Error).message);
    }
  }

  private async fallbackToCacheOrThrow(docType: LegalDocType, reason: string): Promise<LegalDocumentContent> {
    const cached = await this.cache.readPointer(docType);
    if (cached) return cached;
    throw new Error(`legal:getCurrentContent failed for ${docType}: ${reason}`);
  }

  /** The documents in force the caller has not accepted: `legal.documents` of `bootstrap_session()`. */
  async getPendingForCurrentUser(): Promise<LegalPendingItem[]> {
    const session = await fetchBootstrapSession(this.client);
    return session.legalDocuments.map(mapPendingDocument);
  }

  async acceptVersion(input: AcceptLegalDocumentInput): Promise<AcceptLegalDocumentResult> {
    const data = await mapRuleErrors(
      async () =>
        unwrapCall(
          'rpc:accept_legal_document',
          await this.client.rpc('accept_legal_document', {
            p_doc_type: input.docType,
            p_version: input.version,
            p_locale: input.locale,
            p_user_agent: input.userAgent,
          }),
        ),
      (reason, cause) => {
        const code = CONSENT_CODES[reason as keyof typeof CONSENT_CODES];
        return code ? new LegalConsentError(code, cause) : null;
      },
    );
    const row = data as { acceptance_id: string; accepted_at: string };
    return {
      acceptanceId: row.acceptance_id,
      acceptedAt: new Date(row.accepted_at),
    };
  }
}

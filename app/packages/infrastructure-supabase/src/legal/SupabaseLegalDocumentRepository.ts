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
import { CachedLegalDocumentRepository } from './CachedLegalDocumentRepository';
import type { LegalDocumentCache } from './legalCache';

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

/**
 * The legal documents as the database holds them, with no cache: the part of
 * the port the API can serve. `getCurrentContent` throws when the document
 * cannot be read; the device wraps this source in `CachedLegalDocumentRepository`
 * for the offline copy.
 */
export class SupabaseLegalDocumentSource implements ILegalDocumentRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async getCurrentContent(docType: LegalDocType): Promise<LegalDocumentContent> {
    const failed = (reason: string) => new Error(`legal:getCurrentContent failed for ${docType}: ${reason}`);
    try {
      return await this.readCurrent(docType, failed);
    } catch (error) {
      // A thrown request (no network) reads the same as a refused one.
      throw error instanceof Error && error.message.startsWith('legal:') ? error : failed((error as Error).message);
    }
  }

  private async readCurrent(docType: LegalDocType, failed: (reason: string) => Error): Promise<LegalDocumentContent> {
    const ptr = await this.client.from('legal_documents').select('current_version').eq('doc_type', docType).single();
    if (ptr.error || !ptr.data) throw failed(ptr.error?.message ?? 'no pointer row');

    const versionQ = await this.client
      .from('legal_document_versions')
      .select('doc_type, version, effective_date, body_md, content_hash, severity, change_summary, published_at')
      .eq('doc_type', docType)
      .eq('version', ptr.data.current_version)
      .single();
    if (versionQ.error || !versionQ.data) throw failed(versionQ.error?.message ?? 'no version row');

    return mapVersionRow(versionQ.data);
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

/**
 * The device's legal documents repository when it talks to Supabase directly:
 * the database source behind the offline cache.
 */
export class SupabaseLegalDocumentRepository extends CachedLegalDocumentRepository {
  constructor(client: SupabaseClient<Database>, cache: LegalDocumentCache) {
    super(new SupabaseLegalDocumentSource(client), cache);
  }
}

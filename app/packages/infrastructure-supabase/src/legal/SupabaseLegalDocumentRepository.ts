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
import type { Database } from '../database.legacy.types';
import { LegalDocumentCache } from './legalCache';

type VersionRow = {
  doc_type: LegalDocType;
  version: number;
  effective_date: string;
  body_md: string;
  content_hash: string;
  severity: LegalSeverity;
  change_summary: string | null;
  published_at: string;
};

type PendingRow = {
  doc_type: LegalDocType;
  current_version: number;
  current_effective_date: string;
  last_material_version: number;
  last_material_severity: LegalSeverity | null;
  last_accepted_version: number;
  block_mode: LegalBlockMode;
};

function mapVersionRow(row: VersionRow): LegalDocumentContent {
  return {
    docType: row.doc_type,
    version: row.version,
    effectiveDate: new Date(row.effective_date),
    bodyMd: row.body_md,
    contentHash: row.content_hash,
    severity: row.severity,
    changeSummary: row.change_summary,
    publishedAt: new Date(row.published_at),
  };
}

function mapPendingRow(row: PendingRow): LegalPendingItem {
  return {
    docType: row.doc_type,
    currentVersion: row.current_version,
    currentEffectiveDate: new Date(row.current_effective_date),
    lastAcceptedVersion: row.last_accepted_version,
    severity: row.last_material_severity ?? 'standard',
    blockMode: row.block_mode,
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

      const fresh = mapVersionRow(versionQ.data as VersionRow);
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

  async getPendingForCurrentUser(): Promise<LegalPendingItem[]> {
    const { data, error } = await this.client.rpc('needs_legal_reacknowledgement');
    if (error) {
      throw new Error(`legal:getPendingForCurrentUser failed: ${error.message}`);
    }
    if (!data) return [];
    const rows = data as unknown as PendingRow[];
    return rows.map(mapPendingRow);
  }

  async acceptVersion(input: AcceptLegalDocumentInput): Promise<AcceptLegalDocumentResult> {
    const { data, error } = await this.client.rpc('accept_legal_document', {
      p_doc_type: input.docType,
      p_version: input.version,
      p_locale: input.locale,
      p_user_agent: input.userAgent,
    });
    if (error) {
      throw new Error(`legal:acceptVersion failed: ${error.message}`);
    }
    const row = data as unknown as { acceptance_id: string; accepted_at: string };
    return {
      acceptanceId: row.acceptance_id,
      acceptedAt: new Date(row.accepted_at),
    };
  }
}

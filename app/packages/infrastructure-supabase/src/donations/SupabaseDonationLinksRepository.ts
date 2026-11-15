import type { SupabaseClient } from '@supabase/supabase-js';
import { isBackendObjectMissing } from '../rpc/backendUnavailable';
import type { DonationCategorySlug, DonationLink, DonationLinkReviewStatus } from '@kc/domain';
import { DonationLinkError } from '@kc/application';
import type {
  AddDonationLinkInput,
  DonationLinkReviewItem,
  IDonationLinksRepository,
  UpdateDonationLinkInput,
} from '@kc/application';
import type { Database } from '../database.types';
import { BackendRuleError, BackendUnavailableError } from '@kc/domain';
import { unwrapCall } from '../rpc/mapRpcError';
import {
  donationLinkErrorFromInvokeData,
  donationLinkErrorFromInvokeFailure,
} from './parseDonationLinkInvokeError';

type Client = SupabaseClient<Database>;
type LinkRow = Database['public']['Tables']['donation_links']['Row'];

/** The most links one category list shows. */
const LIST_LIMIT = 100;

function mapRow(row: LinkRow): DonationLink {
  return {
    id: row.id,
    categorySlug: row.category_slug as DonationCategorySlug,
    url: row.url,
    displayName: row.display_name,
    description: row.description,
    submittedBy: row.submitted_by,
    validatedAt: row.validated_at,
    createdAt: row.created_at,
    reviewStatus: row.review_status as DonationLinkReviewStatus,
    reviewNote: row.review_note,
  };
}

interface EdgeAnswer {
  ok: boolean;
  code?: string;
  link?: LinkRow;
}

/**
 * Community donation links. Reads, reports and deletes go to the table and its RPCs; adding or
 * editing a link is the `validate-donation-link` Edge Function (it checks the address and writes
 * with the service role). A new or edited link waits in the review queue (`review_status`).
 */
export class SupabaseDonationLinksRepository implements IDonationLinksRepository {
  constructor(private readonly client: Client) {}

  /** Approved links of the list, plus the caller's own with their review state; newest first. */
  async listByCategory(slug: DonationCategorySlug): Promise<DonationLink[]> {
    const rows = await this.guarded('table:donation_links', async () =>
      unwrapCall(
        'table:donation_links',
        await this.client
          .from('donation_links')
          .select('*')
          .eq('category_slug', slug)
          .order('created_at', { ascending: false })
          .limit(LIST_LIMIT),
      ),
    );
    return (rows ?? []).map(mapRow);
  }

  addViaEdgeFunction(input: AddDonationLinkInput): Promise<DonationLink> {
    return this.invoke({
      category_slug: input.categorySlug,
      url: input.url,
      display_name: input.displayName,
      description: input.description ?? null,
    });
  }

  updateViaEdgeFunction(input: UpdateDonationLinkInput): Promise<DonationLink> {
    return this.invoke({
      link_id: input.linkId,
      category_slug: input.categorySlug,
      url: input.url,
      display_name: input.displayName,
      description: input.description ?? null,
    });
  }

  private async invoke(body: Record<string, unknown>): Promise<DonationLink> {
    const { data, error } = await this.client.functions.invoke<EdgeAnswer>('validate-donation-link', { body });
    if (error) throw await donationLinkErrorFromInvokeFailure(error);
    if (!data?.ok || !data.link) throw donationLinkErrorFromInvokeData(data);
    return mapRow(data.link);
  }

  /** The submitter (or the super admin) removes a link for good; the policy refuses anyone else. */
  async deleteById(linkId: string): Promise<void> {
    await this.guarded('table:donation_links', async () =>
      unwrapCall('table:donation_links', await this.client.from('donation_links').delete().eq('id', linkId)),
    );
  }

  /** Reports a link to the support team (a system line in the caller's support thread). */
  async report(linkId: string): Promise<void> {
    await this.guarded('rpc:report_donation_link', async () =>
      unwrapCall('rpc:report_donation_link', await this.client.rpc('report_donation_link', { p_link_id: linkId })),
    );
  }

  /** D9 — the reviewer's queue: links in `status`, oldest first, with the submitters' names. */
  async listForReview(status: DonationLinkReviewStatus): Promise<DonationLinkReviewItem[]> {
    const rows =
      (await this.guarded('table:donation_links', async () =>
        unwrapCall(
          'table:donation_links',
          await this.client.from('donation_links').select('*').eq('review_status', status).order('created_at', { ascending: true }),
        ),
      )) ?? [];
    if (rows.length === 0) return [];
    const users = await this.guarded('table:users', async () =>
      unwrapCall(
        'table:users',
        await this.client.from('users').select('id, display_name').in('id', [...new Set(rows.flatMap((row) => (row.submitted_by === null ? [] : [row.submitted_by])))]),
      ),
    );
    const names = new Map((users ?? []).map((user) => [user.id, user.display_name]));
    return rows.map((row) => ({
      id: row.id,
      categorySlug: row.category_slug as DonationCategorySlug,
      url: row.url,
      displayName: row.display_name,
      description: row.description,
      submittedBy: row.submitted_by,
      submitterName: (row.submitted_by === null ? null : names.get(row.submitted_by)) ?? null,
      reviewStatus: row.review_status as DonationLinkReviewStatus,
      reviewNote: row.review_note,
      createdAt: row.created_at,
    }));
  }

  /** D9 — approve or reject one pending link; a rejection may carry a short note. */
  async review(linkId: string, approve: boolean, note?: string | null): Promise<DonationLinkReviewStatus> {
    const status = await this.guarded('rpc:admin_review_donation_link', async () =>
      unwrapCall(
        'rpc:admin_review_donation_link',
        await this.client.rpc('admin_review_donation_link', { p_link_id: linkId, p_approve: approve, p_note: note ?? undefined }),
      ),
    );
    return status as DonationLinkReviewStatus;
  }

  /**
   * Runs one call and turns its failure into the module's own error: a missing backend object stays
   * `BackendUnavailableError` (degrade rule), a refused staff call is `forbidden`, anything else `network`.
   */
  private async guarded<T>(object: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof BackendUnavailableError || error instanceof DonationLinkError) throw error;
      const cause = (error as { cause?: { code?: string; message?: string } }).cause;
      const refused = cause?.code === '42501' && !isBackendObjectMissing(cause);
      const reason = error instanceof BackendRuleError ? error.reason : null;
      let code: 'forbidden' | 'unknown' | 'network' = 'network';
      if (refused || reason === 'unauthenticated') code = 'forbidden';
      else if (reason) code = 'unknown';
      throw new DonationLinkError(code, error instanceof Error ? error.message : object, error);
    }
  }
}

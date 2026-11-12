import type { DonationCategorySlug, DonationLink } from '@kc/domain';
import type {
  AddDonationLinkInput,
  IDonationLinksRepository,
  UpdateDonationLinkInput,
} from '../../ports/IDonationLinksRepository';

export function makeLink(overrides: Partial<DonationLink> = {}): DonationLink {
  return {
    id: 'l_1',
    categorySlug: 'food',
    url: 'https://example.org',
    displayName: 'Example NGO',
    description: null,
    submittedBy: 'u_1',
    validatedAt: '2026-05-10T00:00:00.000Z',
    createdAt: '2026-05-10T00:00:00.000Z',
    reviewStatus: 'approved',
    reviewNote: null,
    ...overrides,
  };
}

export class FakeDonationLinksRepository implements IDonationLinksRepository {
  listResult: DonationLink[] = [];
  addResult: DonationLink = makeLink();
  updateResult: DonationLink = makeLink();
  addError: Error | null = null;
  updateError: Error | null = null;
  hideError: Error | null = null;
  reportError: Error | null = null;
  deleteError: Error | null = null;

  lastListSlug: DonationCategorySlug | null = null;
  lastAddInput: AddDonationLinkInput | null = null;
  lastUpdateInput: UpdateDonationLinkInput | null = null;
  lastHideId: string | null = null;
  lastReportedLinkId: string | null = null;
  lastDeleteId: string | null = null;

  async listByCategory(slug: DonationCategorySlug): Promise<DonationLink[]> {
    this.lastListSlug = slug;
    return this.listResult;
  }

  async addViaEdgeFunction(input: AddDonationLinkInput): Promise<DonationLink> {
    this.lastAddInput = input;
    if (this.addError) throw this.addError;
    return this.addResult;
  }

  async updateViaEdgeFunction(input: UpdateDonationLinkInput): Promise<DonationLink> {
    this.lastUpdateInput = input;
    if (this.updateError) throw this.updateError;
    return this.updateResult;
  }

  async deleteById(linkId: string): Promise<void> {
    this.lastDeleteId = linkId;
    if (this.deleteError) throw this.deleteError;
  }

  async report(linkId: string): Promise<void> {
    this.lastReportedLinkId = linkId;
    if (this.reportError) throw this.reportError;
  }

  // D9 review methods: not exercised by these use-case tests (ReviewDonationLinksUseCases.test
  // drives its own stub), so they answer with an empty queue and echo the decision.
  async listForReview(): Promise<[]> {
    return [];
  }

  async review(_linkId: string, approve: boolean): Promise<'approved' | 'rejected'> {
    return approve ? 'approved' : 'rejected';
  }
}

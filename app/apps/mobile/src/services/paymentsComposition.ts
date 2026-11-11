// Composition root of the money world (FR-DONATE-011, FR-ORG-010, FR-FIN-021): donations to
// organizations, standing orders and receipts over the billing RPCs, amounts in agorot.
import {
  SupabaseKcSupportChannelsRepository,
  SupabasePaymentsRepository,
  getSupabaseClient,
} from '@kc/infrastructure-supabase';
import {
  CancelStandingOrderUseCase,
  CreateStandingOrderUseCase,
  DonateNowUseCase,
  GetDonationReceiptUseCase,
  GetKcSupportOptionsUseCase,
  GetNonprofitPublicPageUseCase,
  ListDonationHistoryUseCase,
  ListMyStandingOrdersUseCase,
  ListVerifiedNonprofitsUseCase,
  PauseStandingOrderUseCase,
  ResumeStandingOrderUseCase,
} from '@kc/application';
import * as Crypto from 'expo-crypto';
import { pickAuthStorage } from './authSecureStorage';

let _repo: SupabasePaymentsRepository | null = null;

function repo() {
  _repo ??= new SupabasePaymentsRepository(getSupabaseClient({ storage: pickAuthStorage() }));
  return _repo;
}

export const paymentsUseCases = {
  listNonprofits: () => new ListVerifiedNonprofitsUseCase(repo()),
  getNonprofitPage: () => new GetNonprofitPublicPageUseCase(repo()),
  donateNow: () => new DonateNowUseCase(repo()),
  createStandingOrder: () => new CreateStandingOrderUseCase(repo()),
  listStandingOrders: () => new ListMyStandingOrdersUseCase(repo()),
  cancelStandingOrder: () => new CancelStandingOrderUseCase(repo()),
  pauseStandingOrder: () => new PauseStandingOrderUseCase(repo()),
  resumeStandingOrder: () => new ResumeStandingOrderUseCase(repo()),
  listHistory: () => new ListDonationHistoryUseCase(repo()),
  getReceipt: () => new GetDonationReceiptUseCase(repo()),
  /** FR-DONATE-011 — direct support for KC; channels are server config only (D20, D64). */
  kcSupportOptions: () => new GetKcSupportOptionsUseCase(new SupabaseKcSupportChannelsRepository()),
};

export function newIdempotencyKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Crypto.randomUUID()}`;
}

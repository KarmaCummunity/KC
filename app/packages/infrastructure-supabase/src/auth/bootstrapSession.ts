// Session start in one call: `bootstrap_session()` (supabase/schemas/10_identity/100_bootstrap_session.sql).
//
// The RPC answers with the account gate, the caller's private profile and the legal consent
// prompt as one jsonb document. This module is the only place that knows its shape: it reads
// the document defensively (a missing key falls back to a neutral value, never to a crash) and
// hands the adapters typed records. Callers: the account gate, the private-profile reads, the
// onboarding bootstrap and the legal re-acknowledgement prompt.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

/** The account gate: `status` other than `active` sends the app to the matching screen. */
export interface BootstrapAccount {
  readonly status: string;
  /** End of a temporary suspension; null for every other status. */
  readonly statusUntil: string | null;
  readonly onboardingState: string;
  readonly deletionRequestedAt: string | null;
  /** Purge date while the account is pending deletion (the end of the 30-day grace period). */
  readonly deletionPurgeAt: string | null;
}

/** The caller's own `user_private` row. */
export interface BootstrapPrivateProfile {
  readonly contactPhone: string | null;
  /** ISO `YYYY-MM-DD`. */
  readonly dateOfBirth: string | null;
  readonly profileStreet: string | null;
  readonly profileStreetNumber: string | null;
  /** Stored JSON object; `{}` until the member changes a preference. */
  readonly notificationPreferences: Record<string, Json | undefined>;
  readonly showActiveStatus: boolean;
  readonly closureExplainerDismissed: boolean;
  readonly firstPostNudgeDismissed: boolean;
  readonly basicInfoSkipped: boolean;
}

/** A legal document in force whose last material version the caller has not accepted. */
export interface BootstrapLegalDocument {
  readonly docType: string;
  readonly currentVersion: number;
  readonly currentEffectiveDate: string;
  readonly lastMaterialVersion: number;
  readonly lastMaterialSeverity: string | null;
  readonly lastAcceptedVersion: number;
  /** `modal` blocks the app, `banner` is the 7-day notice of a standard change. */
  readonly blockMode: string;
}

export interface BootstrapSession {
  readonly userId: string;
  readonly account: BootstrapAccount;
  readonly privateProfile: BootstrapPrivateProfile;
  readonly legalDocuments: readonly BootstrapLegalDocument[];
  /** Staff roles of the caller (`admin.roles`); empty for an ordinary member. */
  readonly adminRoles: readonly string[];
}

type JsonRecord = { readonly [key: string]: Json | undefined };

function asRecord(value: Json | undefined): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asText(value: Json | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: Json | undefined): number {
  return typeof value === 'number' ? value : 0;
}

/** A boolean flag; a missing or non-boolean value reads as `fallback`. */
function asFlag(value: Json | undefined, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function parseAccount(raw: JsonRecord): BootstrapAccount {
  return {
    status: asText(raw['status']) ?? '',
    statusUntil: asText(raw['status_until']),
    onboardingState: asText(raw['onboarding_state']) ?? '',
    deletionRequestedAt: asText(raw['deletion_requested_at']),
    deletionPurgeAt: asText(raw['deletion_purge_at']),
  };
}

function parsePrivateProfile(raw: JsonRecord): BootstrapPrivateProfile {
  return {
    contactPhone: asText(raw['contact_phone']),
    dateOfBirth: asText(raw['date_of_birth']),
    profileStreet: asText(raw['profile_street']),
    profileStreetNumber: asText(raw['profile_street_number']),
    notificationPreferences: asRecord(raw['notification_preferences']),
    // The column defaults to true, so a payload without the key keeps the default.
    showActiveStatus: asFlag(raw['show_active_status'], true),
    closureExplainerDismissed: asFlag(raw['closure_explainer_dismissed'], false),
    firstPostNudgeDismissed: asFlag(raw['first_post_nudge_dismissed'], false),
    basicInfoSkipped: asFlag(raw['basic_info_skipped'], false),
  };
}

function parseLegalDocument(raw: JsonRecord): BootstrapLegalDocument {
  return {
    docType: asText(raw['doc_type']) ?? '',
    currentVersion: asNumber(raw['current_version']),
    currentEffectiveDate: asText(raw['current_effective_date']) ?? '',
    lastMaterialVersion: asNumber(raw['last_material_version']),
    lastMaterialSeverity: asText(raw['last_material_severity']),
    lastAcceptedVersion: asNumber(raw['last_accepted_version']),
    blockMode: asText(raw['block_mode']) ?? 'banner',
  };
}

function parseStringList(value: Json | undefined): string[] {
  return (Array.isArray(value) ? value : []).filter((item): item is string => typeof item === 'string');
}

/** Reads the `bootstrap_session()` document into typed records. */
export function parseBootstrapSession(payload: Json): BootstrapSession {
  const root = asRecord(payload);
  const documents = asRecord(root['legal'])['documents'];
  return {
    userId: asText(root['user_id']) ?? '',
    account: parseAccount(asRecord(root['account'])),
    privateProfile: parsePrivateProfile(asRecord(root['private_profile'])),
    legalDocuments: (Array.isArray(documents) ? documents : []).map((doc) => parseLegalDocument(asRecord(doc))),
    adminRoles: parseStringList(asRecord(root['admin'])['roles']),
  };
}

/**
 * One round trip with everything the app decides on after sign-in. Refuses with the stable
 * reason `unauthenticated` (a `BackendRuleError`) when nobody is signed in.
 */
export function fetchBootstrapSession(client: SupabaseClient<Database>): Promise<BootstrapSession> {
  const pending = inFlightBootstrapReads.get(client);
  if (pending) return pending;
  const read = readBootstrapSession(client).finally(() => inFlightBootstrapReads.delete(client));
  inFlightBootstrapReads.set(client, read);
  return read;
}

/**
 * The `bootstrap_session()` read that is on the wire right now, per client. Several features
 * ask for the same document at the same moment after sign-in and cold start (account gate,
 * onboarding routing, own profile, legal documents), so concurrent callers share one round
 * trip. Nothing is kept once the read settles: the next call always reads fresh state, and a
 * failed read is never replayed.
 */
const inFlightBootstrapReads = new WeakMap<SupabaseClient<Database>, Promise<BootstrapSession>>();

async function readBootstrapSession(client: SupabaseClient<Database>): Promise<BootstrapSession> {
  return parseBootstrapSession(unwrapCall('rpc:bootstrap_session', await client.rpc('bootstrap_session')));
}

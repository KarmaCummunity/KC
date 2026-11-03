// ─────────────────────────────────────────────
// DOMAIN INVARIANTS — Karma Community
// Mapped to SRS Part III § 3.5
// These are pure functions — no I/O, no imports from infrastructure.
// ─────────────────────────────────────────────

import type { PostVisibility } from './value-objects';

// ── Visibility / Privacy ──────────────────────

/**
 * Whether a post visibility change should be applied (non–no-op).
 * Revised FR-POST-009 / D-32 (2026-05-17): any transition between visibility levels is allowed;
 * callers use this only to skip redundant updates. DB no longer enforces upgrade-only
 * (`0094_posts_visibility_free_change.sql`).
 */
export function canUpgradeVisibility(
  current: PostVisibility,
  next: PostVisibility,
): boolean {
  return current !== next;
}

/**
 * INV-L1: Active post limit per user.
 * Enforced server-side by `posts_enforce_active_cap` trigger (migration 0002).
 * Mapped to: R-MVP-Items-8, R-MVP-Items-14
 */
export const MAX_ACTIVE_POSTS = 20;

/**
 * INV-C3: Excessive reopens trigger moderation queue.
 * Enforced server-side by `posts_after_update_reopen_count` trigger (migration 0005).
 * Mapped to: R-MVP-Items-7
 */
export const REOPEN_SUSPECT_THRESHOLD = 5;

/**
 * INV-L2: Max media assets per post.
 * Mapped to: FR-POST-005
 */
export const MAX_MEDIA_ASSETS = 5;

/**
 * INV-L3: Chats have exactly 2 participants.
 */
export const CHAT_PARTICIPANT_COUNT = 2;

/**
 * Follow request cooldown (days).
 * Mapped to: R-MVP-Privacy-12
 */
export const FOLLOW_REQUEST_COOLDOWN_DAYS = 14;

/**
 * Deleted_no_recipient grace period (days).
 * Mapped to: R-MVP-Items-4
 */
export const DELETE_NO_RECIPIENT_GRACE_DAYS = 7;

/**
 * Account deletion re-registration cooldown (days).
 * Mapped to: D-12
 */
export const ACCOUNT_DELETION_COOLDOWN_DAYS = 30;

/**
 * Biography max length.
 * Mapped to: R-MVP-Profile-6
 */
export const BIO_MAX_CHARS = 200;

/**
 * Post title max length.
 */
export const TITLE_MAX_CHARS = 80;

/**
 * Post description max length.
 */
export const DESCRIPTION_MAX_CHARS = 500;

/**
 * Message body max length.
 */
export const MESSAGE_MAX_CHARS = 2000;

/**
 * Report note max length.
 * Mapped to: FR-MOD-001 (DB CHECK on reports.note)
 */
export const REPORT_NOTE_MAX_LENGTH = 500;

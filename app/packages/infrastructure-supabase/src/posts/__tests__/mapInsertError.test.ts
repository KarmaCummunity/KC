import { describe, it, expect } from 'vitest';
import { mapInsertError } from '../mapInsertError';

interface PgErr {
  code?: string;
  message?: string;
  details?: string;
}

function pg(code: string, message = '', details = ''): PgErr {
  return { code, message, details };
}

describe('mapInsertError (TD-50 follow-up)', () => {
  // ── 23503 foreign_key_violation ──────────────────────────────────────────
  it('maps 23503 with "city" in message → city_not_found', () => {
    const out = mapInsertError(pg('23503', 'violates foreign key constraint posts_city_fkey'));
    expect(out.code).toBe('city_not_found');
  });

  it('maps 23503 with "city" in details → city_not_found', () => {
    const out = mapInsertError(pg('23503', '', 'Key (city)=(unknown-1) is not present in table "cities".'));
    expect(out.code).toBe('city_not_found');
  });

  it('maps 23503 owner FK → forbidden', () => {
    const out = mapInsertError(pg('23503', 'violates foreign key constraint posts_owner_fkey'));
    expect(out.code).toBe('forbidden');
  });

  // ── D132 offer photo rule (0741) ────────────────────────────────────────
  it('maps offer_photo_required → image_required_for_give', () => {
    const out = mapInsertError(pg('23514', 'offer_photo_required'));
    expect(out.code).toBe('image_required_for_give');
  });

  // ── 23514 check_violation ───────────────────────────────────────────────
  it('maps 23514 with "street_number" → street_number_invalid', () => {
    const out = mapInsertError(pg('23514', 'new row violates posts_street_number_chk'));
    expect(out.code).toBe('street_number_invalid');
  });

  it('maps 23514 with "type_fields" → invalid_post_type', () => {
    const out = mapInsertError(pg('23514', 'violates posts_type_fields_chk'));
    expect(out.code).toBe('invalid_post_type');
  });

  it('maps 23514 with another constraint name → address_invalid', () => {
    const out = mapInsertError(pg('23514', 'violates posts_address_chk'));
    expect(out.code).toBe('address_invalid');
  });

  it('maps 23514 active_post_limit_exceeded → active_post_limit_exceeded', () => {
    const out = mapInsertError(pg('23514', 'active_post_limit_exceeded', 'limit=20'));
    expect(out.code).toBe('active_post_limit_exceeded');
  });

  it('maps 23514 item_condition check → condition_required_for_give', () => {
    const out = mapInsertError(pg('23514', 'violates posts_item_condition_check'));
    expect(out.code).toBe('condition_required_for_give');
  });

  it('maps 23514 street (not street_number) check → address_required', () => {
    const out = mapInsertError(pg('23514', 'violates posts_street_check'));
    expect(out.code).toBe('address_required');
  });

  // ── 23502 not_null_violation ────────────────────────────────────────────
  it('maps 23502 → address_required', () => {
    const out = mapInsertError(pg('23502', 'null value in column "city" violates not-null'));
    expect(out.code).toBe('address_required');
  });

  // ── 42501 insufficient_privilege ────────────────────────────────────────
  it('maps 42501 → followers_only_requires_private', () => {
    const out = mapInsertError(pg('42501', 'new row violates row-level security policy'));
    expect(out.code).toBe('followers_only_requires_private');
  });

  // ── Fallthrough ─────────────────────────────────────────────────────────
  it('maps unknown pg code → unknown', () => {
    const out = mapInsertError(pg('99999', 'mystery error'));
    expect(out.code).toBe('unknown');
  });

  it('returns unknown for non-pg-shaped throwables', () => {
    expect(mapInsertError(new Error('plain js')).code).toBe('unknown');
    expect(mapInsertError(null).code).toBe('unknown');
    expect(mapInsertError(undefined).code).toBe('unknown');
    expect(mapInsertError('string').code).toBe('unknown');
  });

  // ── Message preservation ────────────────────────────────────────────────
  it('preserves the original pg message in the wrapped error', () => {
    const out = mapInsertError(pg('23503', 'violates city_fkey'));
    expect(out.message).toContain('violates city_fkey');
  });

  it('preserves the original throwable as the cause', () => {
    const src = pg('23503', 'violates city_fkey');
    const out = mapInsertError(src);
    expect(out.cause).toBe(src);
  });
});

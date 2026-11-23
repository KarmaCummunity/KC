import { describe, expect, it } from 'vitest';
import {
  isValidateDonationLinkEdgeErrorCode,
  VALIDATE_DONATION_LINK_EDGE_ERROR_CODES,
  type ValidateDonationLinkFailResponse,
  type ValidateDonationLinkOkResponse,
  type ValidateDonationLinkRequestBody,
} from '../validateDonationLinkContract';

describe('validateDonationLinkContract', () => {
  it('lists every Edge failure code the handler documents (DON-7)', () => {
    expect([...VALIDATE_DONATION_LINK_EDGE_ERROR_CODES].sort()).toEqual(
      [
        'forbidden',
        'invalid_input',
        'invalid_url',
        'rate_limited',
        'server_error',
        'unauthorized',
        'unreachable',
      ].sort(),
    );
  });

  it('accepts only known Edge codes', () => {
    expect(isValidateDonationLinkEdgeErrorCode('server_error')).toBe(true);
    expect(isValidateDonationLinkEdgeErrorCode('invalid_input')).toBe(true);
    expect(isValidateDonationLinkEdgeErrorCode('network')).toBe(false);
    expect(isValidateDonationLinkEdgeErrorCode('unknown')).toBe(false);
    expect(isValidateDonationLinkEdgeErrorCode(undefined)).toBe(false);
  });

  it('types insert and update request bodies with snake_case wire keys', () => {
    const insert: ValidateDonationLinkRequestBody = {
      category_slug: 'food',
      url: 'https://a.example',
      display_name: 'A',
      description: null,
    };
    const update: ValidateDonationLinkRequestBody = {
      link_id: 'l1',
      category_slug: 'food',
      url: 'https://a.example',
      display_name: 'A',
      description: 'x',
    };
    expect(insert).not.toHaveProperty('link_id');
    expect(update.link_id).toBe('l1');
  });

  it('types success and failure response envelopes', () => {
    const ok: ValidateDonationLinkOkResponse = {
      ok: true,
      link: {
        id: 'l1',
        category_slug: 'food',
        url: 'https://a.example',
        display_name: 'A',
        description: null,
        submitted_by: 'u1',
        validated_at: '2026-01-01T00:00:00Z',
        review_status: 'pending',
        review_note: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    };
    const fail: ValidateDonationLinkFailResponse = { ok: false, code: 'server_error' };
    expect(ok.ok).toBe(true);
    expect(fail.code).toBe('server_error');
  });
});

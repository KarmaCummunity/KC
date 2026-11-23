import { describe, it, expect } from 'vitest';
import { DonationLinkError } from '@kc/application';
import {
  donationLinkErrorFromInvokeData,
  donationLinkErrorFromInvokeFailure,
} from '../parseDonationLinkInvokeError';

describe('parseDonationLinkInvokeError', () => {
  it('maps ok=false body codes from invoke data', () => {
    const err = donationLinkErrorFromInvokeData({ ok: false, code: 'unreachable' });
    expect(err).toMatchObject({ code: 'unreachable', name: 'DonationLinkError' });
  });

  it('preserves Edge server_error instead of collapsing to unknown (DON-7)', () => {
    const err = donationLinkErrorFromInvokeData({ ok: false, code: 'server_error' });
    expect(err.code).toBe('server_error');
  });

  it('maps unrecognised Edge codes to unknown', () => {
    expect(donationLinkErrorFromInvokeData({ ok: false, code: 'not_a_real_code' }).code).toBe('unknown');
  });

  it('parses ok=false JSON from FunctionsHttpError context', async () => {
    const response = new Response(JSON.stringify({ ok: false, code: 'invalid_url' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    const err = await donationLinkErrorFromInvokeFailure({ context: response, message: 'HTTP 400' });
    expect(err).toBeInstanceOf(DonationLinkError);
    expect(err.code).toBe('invalid_url');
  });

  it('parses server_error from FunctionsHttpError context', async () => {
    const response = new Response(JSON.stringify({ ok: false, code: 'server_error' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    const err = await donationLinkErrorFromInvokeFailure({ context: response, message: 'HTTP 200' });
    expect(err.code).toBe('server_error');
  });

  it('falls back to network when no parseable body exists', async () => {
    const err = await donationLinkErrorFromInvokeFailure(new Error('fetch failed'));
    expect(err.code).toBe('network');
  });
});

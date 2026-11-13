// Auth-event reporting: reason tag, no identifying data, network blips dropped, never throws.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const captureMessage = vi.fn();
const captureException = vi.fn();
let sentryReady = true;
vi.mock('../sentry', () => ({
  getSentryIfInit: () => (sentryReady ? { captureMessage, captureException } : null),
}));

import {
  isIntentionalSignOut,
  markIntentionalSignOut,
  reportAuthEvent,
  reportUnexpectedSignOut,
} from '../reportAuthEvent';

describe('reportAuthEvent', () => {
  beforeEach(() => {
    captureMessage.mockReset();
    captureException.mockReset();
    sentryReady = true;
  });

  it('reports an event without an error as a tagged warning message', () => {
    reportAuthEvent('gate_blocked', { account_status: 'banned' });
    expect(captureMessage).toHaveBeenCalledWith('auth: gate_blocked', {
      level: 'warning',
      tags: { area: 'auth', auth_reason: 'gate_blocked' },
      extra: { account_status: 'banned' },
    });
  });

  it('captures a real error as an exception with the reason tag', () => {
    reportAuthEvent('restore_failed', {}, new Error('boom'));
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'boom' }),
      expect.objectContaining({ tags: { area: 'auth', auth_reason: 'restore_failed' } }),
    );
  });

  it('drops network failures', () => {
    reportAuthEvent('gate_check_failed', {}, new Error('Network request failed'));
    expect(captureException).not.toHaveBeenCalled();
  });

  it('does nothing and does not throw when Sentry is not initialised', () => {
    sentryReady = false;
    expect(() => reportAuthEvent('gate_blocked')).not.toThrow();
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('never throws when the SDK itself throws', () => {
    captureMessage.mockImplementation(() => {
      throw new Error('sdk down');
    });
    expect(() => reportAuthEvent('gate_blocked')).not.toThrow();
  });

  it('tracks an app-initiated sign-out', () => {
    markIntentionalSignOut(true);
    expect(isIntentionalSignOut()).toBe(true);
    markIntentionalSignOut(false);
    expect(isIntentionalSignOut()).toBe(false);
  });

  it('reports an unexpected SIGNED_OUT but not an app-initiated or unrelated event', () => {
    reportUnexpectedSignOut('TOKEN_REFRESHED');
    reportUnexpectedSignOut(undefined);
    markIntentionalSignOut(true);
    reportUnexpectedSignOut('SIGNED_OUT');
    markIntentionalSignOut(false);
    expect(captureMessage).not.toHaveBeenCalled();

    reportUnexpectedSignOut('SIGNED_OUT');
    expect(captureMessage).toHaveBeenCalledWith(
      'auth: session_ended_unexpectedly',
      expect.objectContaining({ extra: { auth_event: 'SIGNED_OUT' } }),
    );
  });
});

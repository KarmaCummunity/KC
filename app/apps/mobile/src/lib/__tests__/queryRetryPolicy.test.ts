import { describe, it, expect } from 'vitest';
import { AuthError } from '@kc/application';
import {
  shouldRetryQuery,
  isNonRetryableError,
  queryRetryDelay,
  DEFAULT_MAX_QUERY_RETRIES,
} from '../queryRetryPolicy';

describe('queryRetryPolicy', () => {
  describe('isNonRetryableError', () => {
    it('returns false for null / undefined / falsy inputs', () => {
      expect(isNonRetryableError(null)).toBe(false);
      expect(isNonRetryableError(undefined)).toBe(false);
    });

    it('identifies 4xx HTTP statuses as non-retryable', () => {
      expect(isNonRetryableError({ status: 400 })).toBe(true);
      expect(isNonRetryableError({ status: 401 })).toBe(true);
      expect(isNonRetryableError({ status: 403 })).toBe(true);
      expect(isNonRetryableError({ status: 404 })).toBe(true);
      expect(isNonRetryableError({ status: 422 })).toBe(true);
      expect(isNonRetryableError({ statusCode: 403 })).toBe(true);
    });

    it('identifies 5xx HTTP statuses as retryable', () => {
      expect(isNonRetryableError({ status: 500 })).toBe(false);
      expect(isNonRetryableError({ status: 502 })).toBe(false);
      expect(isNonRetryableError({ status: 503 })).toBe(false);
    });

    it('identifies PostgreSQL RLS error code 42501 as non-retryable', () => {
      expect(isNonRetryableError({ code: '42501', message: 'insufficient privilege' })).toBe(true);
    });

    it('identifies PostgREST client error codes (PGRST1xx/2xx/3xx) as non-retryable', () => {
      expect(isNonRetryableError({ code: 'PGRST116' })).toBe(true);
      expect(isNonRetryableError({ code: 'PGRST301' })).toBe(true);
    });

    it('identifies AuthError with non-network codes as non-retryable', () => {
      const sessionErr = new AuthError('session_expired', 'Session expired');
      const credsErr = new AuthError('invalid_credentials', 'Invalid login');
      const forbiddenErr = new AuthError('forbidden', 'Forbidden');
      expect(isNonRetryableError(sessionErr)).toBe(true);
      expect(isNonRetryableError(credsErr)).toBe(true);
      expect(isNonRetryableError(forbiddenErr)).toBe(true);
    });

    it('allows AuthError with network code to be retried', () => {
      const netAuthErr = new AuthError('network', 'Network timeout');
      expect(isNonRetryableError(netAuthErr)).toBe(false);
    });

    it('detects RLS, unauthorized, and permission denied phrases in message string', () => {
      expect(isNonRetryableError(new Error('new row violates row-level security policy for table'))).toBe(true);
      expect(isNonRetryableError(new Error('permission denied for table users'))).toBe(true);
      expect(isNonRetryableError(new Error('User is unauthorized'))).toBe(true);
      expect(isNonRetryableError(new Error('JWT expired'))).toBe(true);
      expect(isNonRetryableError(new Error('Not authenticated'))).toBe(true);
    });

    it('allows generic network / TypeError errors to be retried', () => {
      expect(isNonRetryableError(new TypeError('Network request failed'))).toBe(false);
      expect(isNonRetryableError(new Error('Connection reset by peer'))).toBe(false);
      expect(isNonRetryableError(new Error('Failed to fetch'))).toBe(false);
    });
  });

  describe('shouldRetryQuery', () => {
    it('returns false immediately when failureCount reaches maxRetries', () => {
      const netError = new TypeError('Network request failed');
      expect(shouldRetryQuery(0, netError)).toBe(true);
      expect(shouldRetryQuery(1, netError)).toBe(true);
      expect(shouldRetryQuery(2, netError)).toBe(false);
      expect(shouldRetryQuery(DEFAULT_MAX_QUERY_RETRIES, netError)).toBe(false);
    });

    it('returns false on the first attempt (failureCount=0) for 4xx and RLS errors', () => {
      expect(shouldRetryQuery(0, { status: 403 })).toBe(false);
      expect(shouldRetryQuery(0, { code: '42501' })).toBe(false);
      expect(shouldRetryQuery(0, new AuthError('session_expired', 'Session expired'))).toBe(false);
    });

    it('returns true on retryable errors when failureCount is below limit', () => {
      expect(shouldRetryQuery(0, new TypeError('Network request failed'))).toBe(true);
      expect(shouldRetryQuery(1, new TypeError('Network request failed'))).toBe(true);
      expect(shouldRetryQuery(0, { status: 503 })).toBe(true);
      expect(shouldRetryQuery(1, { status: 500 })).toBe(true);
    });
  });

  describe('queryRetryDelay', () => {
    it('computes exponential backoff capping at 30 seconds', () => {
      expect(queryRetryDelay(0)).toBe(1000);
      expect(queryRetryDelay(1)).toBe(2000);
      expect(queryRetryDelay(2)).toBe(4000);
      expect(queryRetryDelay(3)).toBe(8000);
      expect(queryRetryDelay(4)).toBe(16000);
      expect(queryRetryDelay(5)).toBe(30000);
      expect(queryRetryDelay(10)).toBe(30000);
    });
  });
});

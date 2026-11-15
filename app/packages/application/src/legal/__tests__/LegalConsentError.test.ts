import { describe, expect, it } from 'vitest';
import { LegalConsentError, isLegalConsentError } from '../AcceptLegalDocumentUseCase';

describe('LegalConsentError', () => {
  it.each(['version_out_of_range', 'unknown_document'] as const)('carries the code %s and keeps the cause', (code) => {
    const cause = new Error('refused');

    const error = new LegalConsentError(code, cause);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(LegalConsentError);
    expect(error.name).toBe('LegalConsentError');
    expect(error.code).toBe(code);
    expect(error.message).toBe(`legal_consent:${code}`);
    expect(error.cause).toBe(cause);
  });

  it('isLegalConsentError narrows only the consent error', () => {
    expect(isLegalConsentError(new LegalConsentError('unknown_document'))).toBe(true);
    expect(isLegalConsentError(new Error('plain'))).toBe(false);
    expect(isLegalConsentError({ code: 'unknown_document' })).toBe(false);
  });
});

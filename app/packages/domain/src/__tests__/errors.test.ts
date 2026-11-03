import { describe, it, expect } from 'vitest';
import { DomainError, ValidationError } from '../errors';

class TestDomainError extends DomainError {
  readonly code = 'test_error';
}

describe('DomainError', () => {
  it('instantiates correctly with message and details', () => {
    const err = new TestDomainError('something went wrong', { key: 'value' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DomainError);
    expect(err.message).toBe('something went wrong');
    expect(err.code).toBe('test_error');
    expect(err.details).toEqual({ key: 'value' });
    expect(err.name).toBe('TestDomainError');
  });

  it('instantiates correctly without details', () => {
    const err = new TestDomainError('no details');
    expect(err.details).toBeUndefined();
  });
});

describe('ValidationError', () => {
  it('instantiates with field and maps details', () => {
    const err = new ValidationError('invalid field', 'username');
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe('validation');
    expect(err.field).toBe('username');
    expect(err.details).toEqual({ field: 'username' });
  });

  it('instantiates without field and leaves details undefined', () => {
    const err = new ValidationError('invalid input');
    expect(err.field).toBeUndefined();
    expect(err.details).toBeUndefined();
  });
});

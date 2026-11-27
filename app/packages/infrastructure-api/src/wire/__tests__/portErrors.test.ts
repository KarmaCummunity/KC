import { ChatError, FollowError, PostError } from '@kc/application';
import { BackendRuleError, BackendUnavailableError, DomainError } from '@kc/domain';
import { describe, expect, it } from 'vitest';
import { createPortErrorRegistry, PORT_ERRORS, revivePortError, serializePortError } from '../portErrors';

/** What the other side receives: the error, through JSON. */
function overTheWire(error: unknown): Error {
  const wire = serializePortError(error);
  if (!wire) throw new Error('expected a registered port error');
  return revivePortError(JSON.parse(JSON.stringify(wire)));
}

describe('port error codec', () => {
  it('registers the typed errors of the domain and application packages by export name', () => {
    expect(PORT_ERRORS.get('FollowError')).toBe(FollowError);
    expect(PORT_ERRORS.get('BackendRuleError')).toBe(BackendRuleError);
    expect(PORT_ERRORS.size).toBeGreaterThan(40);
  });

  it('rebuilds an error of the same class with its code and extra fields', () => {
    const received = overTheWire(new FollowError('cooldown_active', 'wait', { cooldownUntil: '2026-12-01T00:00:00Z' }));

    expect(received).toBeInstanceOf(FollowError);
    expect(received).toMatchObject({ name: 'FollowError', code: 'cooldown_active', message: 'wait', cooldownUntil: '2026-12-01T00:00:00Z' });
  });

  it('keeps the class hierarchy checks working', () => {
    const received = overTheWire(new BackendRuleError('post_not_found', 'rpc:post_get'));

    expect(received).toBeInstanceOf(BackendRuleError);
    expect(received).toBeInstanceOf(DomainError);
    expect(received).toMatchObject({ code: 'backend_rule', reason: 'post_not_found', object: 'rpc:post_get' });
  });

  it('handles classes with different constructor shapes', () => {
    expect(overTheWire(new PostError('not_found', 'gone'))).toMatchObject({ code: 'not_found', message: 'gone' });
    expect(overTheWire(new ChatError('message_too_long', 'too long'))).toBeInstanceOf(ChatError);
    expect(overTheWire(new BackendUnavailableError('rpc:x', 'function'))).toMatchObject({ code: 'backend_unavailable', kind: 'function' });
  });

  it('never sends the cause or the stack', () => {
    const wire = serializePortError(new PostError('not_found', 'gone', new Error('connection string in here')));

    expect(JSON.stringify(wire)).not.toContain('connection string');
    expect(wire?.fields).not.toHaveProperty('cause');
    expect(wire?.fields).not.toHaveProperty('stack');
  });

  it('gives the revived error a stack of its own', () => {
    expect(overTheWire(new PostError('not_found', 'gone')).stack).toEqual(expect.any(String));
  });

  it('does not serialize what is not a registered error', () => {
    expect(serializePortError(new Error('boom'))).toBeNull();
    expect(serializePortError(new TypeError('x'))).toBeNull();
    expect(serializePortError('a string')).toBeNull();
    expect(serializePortError(undefined)).toBeNull();
  });

  it('picks the most derived registered class', () => {
    class Base extends Error {}
    class Derived extends Base {}
    class Unregistered extends Derived {}
    const registry = createPortErrorRegistry({ Base, Derived, notAnError: 1, plainFunction: () => 0 });

    expect(serializePortError(new Derived('d'), registry)?.type).toBe('Derived');
    expect(serializePortError(new Unregistered('u'), registry)?.type).toBe('Derived');
    expect(serializePortError(new Base('b'), registry)?.type).toBe('Base');
    expect(registry.size).toBe(2);
  });

  it('falls back to a plain error for a class the receiver does not know', () => {
    const received = revivePortError({ type: 'ErrorFromANewerServer', message: 'new rule', fields: { code: 'x' } });

    expect(received).toBeInstanceOf(Error);
    expect(received.message).toBe('new rule');
  });
});

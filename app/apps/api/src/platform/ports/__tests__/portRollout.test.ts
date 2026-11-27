import { describe, expect, it } from 'vitest';
import { resolveRollout, UnknownRolloutPortError } from '../portRollout';

const PORTS = ['post', 'chat', 'legalDocument'];

describe('resolveRollout', () => {
  it('publishes nothing when there are no rules: every port is served to everyone', () => {
    expect(resolveRollout(PORTS, {})).toEqual({});
  });

  it('gives a port its own rule and leaves the others without one', () => {
    expect(resolveRollout(PORTS, { post: { percent: 10 } })).toEqual({ post: { percent: 10 } });
  });

  it('applies the default to every port without a rule of its own', () => {
    expect(resolveRollout(PORTS, { '*': { percent: 0 }, legalDocument: { percent: 100 } })).toEqual({
      post: { percent: 0 },
      chat: { percent: 0 },
      legalDocument: { percent: 100 },
    });
  });

  it('refuses a rule for a port that does not exist, naming it', () => {
    expect(() => resolveRollout(PORTS, { posts: { percent: 10 } })).toThrow(new UnknownRolloutPortError('posts'));
  });
});

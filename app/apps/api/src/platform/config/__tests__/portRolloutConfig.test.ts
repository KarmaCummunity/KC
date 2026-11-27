import { describe, expect, it } from 'vitest';
import { ApiConfigError } from '../configReader';
import { parsePortRollout } from '../portRolloutConfig';

const read = (value: unknown) => parsePortRollout({ KC_PORT_ROLLOUT: typeof value === 'string' ? value : JSON.stringify(value) });

describe('parsePortRollout', () => {
  it('means "everyone" when the variable is unset or empty', () => {
    expect(parsePortRollout({})).toEqual({});
    expect(parsePortRollout({ KC_PORT_ROLLOUT: '  ' })).toEqual({});
  });

  it('reads a rule per port and a default', () => {
    expect(read({ '*': { percent: 0 }, post: { percent: 12.5, minAppVersion: '1.6.0' }, legalDocument: {} })).toEqual({
      '*': { percent: 0 },
      post: { percent: 12.5, minAppVersion: '1.6.0' },
      legalDocument: {},
    });
  });

  it.each([
    ['text that is not JSON', '{post:'],
    ['a list', []],
    ['a number', 7],
    ['a rule that is not an object', { post: 10 }],
    ['a rule that is a list', { post: [] }],
    ['a share below 0', { post: { percent: -1 } }],
    ['a share above 100', { post: { percent: 101 } }],
    ['a share that is text', { post: { percent: '10' } }],
    ['a version that is not three numbers', { post: { minAppVersion: '1.6' } }],
    ['a version with a prefix', { post: { minAppVersion: 'v1.6.0' } }],
    // A typo must not turn a canary into "everyone".
    ['a misspelt field', { post: { precent: 10 } }],
    ['a key that is not a port name', { 'post/../x': { percent: 10 } }],
  ])('refuses %s, naming the variable and not the value', (_case, value) => {
    let thrown: unknown;
    try {
      read(value);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApiConfigError);
    expect((thrown as ApiConfigError).variable).toBe('KC_PORT_ROLLOUT');
  });
});

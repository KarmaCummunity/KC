import type { PortRollout } from '@kc/infrastructure-api';
import { type PortRolloutRules, ROLLOUT_DEFAULT_KEY } from '../config/portRolloutConfig';

/** Injection token of the rollout rule of each served port that has one. */
export const PORT_ROLLOUT = Symbol('PORT_ROLLOUT');

/** A rollout rule names a port this API does not have: a typo would leave the real port served to everyone. */
export class UnknownRolloutPortError extends Error {
  constructor(port: string) {
    super(`KC_PORT_ROLLOUT names "${port}", which is not a port of this API`);
    this.name = 'UnknownRolloutPortError';
  }
}

/**
 * The rule the manifest publishes for each port: its own, or the default
 * (`*`). A port neither covers has no entry, which means everyone.
 * @param portNames Wire names of the ports this API serves.
 * @throws UnknownRolloutPortError at start-up, for a rule whose port does not exist.
 */
export function resolveRollout(portNames: Iterable<string>, rules: PortRolloutRules): Readonly<Record<string, PortRollout>> {
  const known = new Set(portNames);
  const stray = Object.keys(rules).find((port) => port !== ROLLOUT_DEFAULT_KEY && !known.has(port));
  if (stray !== undefined) throw new UnknownRolloutPortError(stray);
  const resolved: Record<string, PortRollout> = {};
  for (const port of known) {
    const rule = rules[port] ?? rules[ROLLOUT_DEFAULT_KEY];
    if (rule) resolved[port] = rule;
  }
  return resolved;
}

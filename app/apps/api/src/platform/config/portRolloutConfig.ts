import type { PortRollout } from '@kc/infrastructure-api';
import { ApiConfigError, type Env, readVariable } from './configReader';

/** Name of the variable that holds the rollout rules. */
const VARIABLE = 'KC_PORT_ROLLOUT';
/** Key of the rule for every port that has none of its own. */
export const ROLLOUT_DEFAULT_KEY = '*';
const PORT_NAME = /^[a-z][A-Za-z0-9]{0,63}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const RULE_FIELDS = new Set(['percent', 'minAppVersion']);

/** Rollout rules by port wire name; `*` is the rule of every port without its own. */
export type PortRolloutRules = Readonly<Record<string, PortRollout>>;

/** One rule, checked field by field. @throws ApiConfigError naming what is wrong, never the value. */
function parseRule(port: string, rule: unknown): PortRollout {
  if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) throw new ApiConfigError(VARIABLE, `the rule of "${port}" must be an object`);
  const { percent, minAppVersion } = rule as Record<string, unknown>;
  // A misspelt field would silently mean "everyone", which is the opposite of what a rule is for.
  const unknown = Object.keys(rule).find((field) => !RULE_FIELDS.has(field));
  if (unknown !== undefined) throw new ApiConfigError(VARIABLE, `the rule of "${port}" has an unknown field`);
  if (percent !== undefined && (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100)) {
    throw new ApiConfigError(VARIABLE, `percent of "${port}" must be a number from 0 to 100`);
  }
  if (minAppVersion !== undefined && (typeof minAppVersion !== 'string' || !VERSION.test(minAppVersion))) {
    throw new ApiConfigError(VARIABLE, `minAppVersion of "${port}" must look like 1.2.3`);
  }
  return { ...(percent !== undefined ? { percent } : {}), ...(minAppVersion !== undefined ? { minAppVersion } : {}) };
}

/**
 * Reads who each port is served to (ADR-010, rollout): a JSON object of port
 * name to `{ percent?, minAppVersion? }`, e.g.
 * `{"*":{"percent":0},"legalDocument":{"percent":100},"post":{"percent":10,"minAppVersion":"1.6.0"}}`.
 * Unset means every served port is served to everyone. Whether a named port
 * exists is checked where the ports are known (`resolveRollout`).
 * @throws ApiConfigError when the value is not such an object.
 */
export function parsePortRollout(env: Env): PortRolloutRules {
  const raw = readVariable(env, VARIABLE);
  if (raw === undefined) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiConfigError(VARIABLE, 'must be JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new ApiConfigError(VARIABLE, 'must be a JSON object of port name to rule');
  const rules: Record<string, PortRollout> = {};
  for (const [port, rule] of Object.entries(parsed)) {
    if (port !== ROLLOUT_DEFAULT_KEY && !PORT_NAME.test(port)) throw new ApiConfigError(VARIABLE, 'has a key that is not a port name');
    rules[port] = parseRule(port, rule);
  }
  return rules;
}

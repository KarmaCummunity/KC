import type { PortRollout } from '../wire/portWire';

/** Who is asking: what a rollout rule is decided on. */
export interface RolloutSubject {
  /** The signed-in member's id, or null for a visitor. */
  readonly memberId: string | null;
  /** The running app's version (`MAJOR.MINOR.PATCH`), or null when the build does not expose one. */
  readonly appVersion: string | null;
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)/;

/** The three numbers of a version, or null for text that is not one. */
function parseVersion(version: string): readonly [number, number, number] | null {
  const match = VERSION.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/**
 * True when `version` is `minimum` or newer. A version that cannot be read is
 * never new enough: a build of unknown age stays on the adapters in place.
 */
export function isAtLeastVersion(version: string | null, minimum: string): boolean {
  const actual = version === null ? null : parseVersion(version);
  const wanted = parseVersion(minimum);
  if (!actual || !wanted) return false;
  for (let part = 0; part < 3; part += 1) {
    const difference = (actual[part] as number) - (wanted[part] as number);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

/**
 * A member's place in a port's rollout: a whole number from 0 to 99, the same
 * on every device and every start (FNV-1a over the port and the id). The port
 * is part of the hash, so the first percent of one port is not the first
 * percent of every port.
 */
export function rolloutBucket(memberId: string, port: string): number {
  const text = `${port}:${memberId}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    // Multiplication by the FNV prime 16777619, kept in 32 bits.
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 100;
}

/**
 * True when the port is served to this subject under `rollout`. A member
 * whose place is below the share is in, and stays in as the share grows. A
 * visitor has no place: they are served only when the share is everyone.
 */
export function isServedTo(port: string, rollout: PortRollout | undefined, subject: RolloutSubject): boolean {
  if (!rollout) return true;
  if (rollout.minAppVersion !== undefined && !isAtLeastVersion(subject.appVersion, rollout.minAppVersion)) return false;
  const percent = rollout.percent ?? 100;
  if (percent >= 100) return true;
  if (percent <= 0 || subject.memberId === null) return false;
  return rolloutBucket(subject.memberId, port) < percent;
}

/** True when deciding `rollout` needs to know who the member is. */
export function needsMemberId(rollout: PortRollout | undefined): boolean {
  const percent = rollout?.percent ?? 100;
  return percent > 0 && percent < 100;
}

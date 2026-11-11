// Turns an organizations failure into its copy key (`organizations.errors.*`). The server and the
// domain share the codes (0730), so one table covers both.
import { OrgError, type OrgErrorCode } from '@kc/domain';

export function orgErrorKey(error: unknown): `organizations.errors.${OrgErrorCode}` {
  const code: OrgErrorCode = error instanceof OrgError ? error.code : 'unknown';
  return `organizations.errors.${code}`;
}

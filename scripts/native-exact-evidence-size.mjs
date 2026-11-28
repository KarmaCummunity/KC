import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;
export function validateEvidenceBytes(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_EVIDENCE_BYTES) throw new Error('Encrypted evidence must be nonempty and at most 25 MiB; upload blocked');
  return { bytes, limitBytes: MAX_EVIDENCE_BYTES };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(validateEvidenceBytes(statSync(process.argv[2]).size)));

// KC #2509: fail closed on both workflow snapshot and deployed tree.
// These are byte hashes of the reviewed preservation implementation in #2510.
// An intentional edit needs a new review and contract update, not a marker bypass.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
export const PRESERVATION_FILES = {
  ".github/workflows/deploy.yml": "9f5b3040713395cbe79b360dd199db3c768b9f01190d129b8693d0dbdb465572",
  ".github/workflows/deploy-db.yml": "195763ea973cf7b49e752d3a8fe4457f1e981e55350f1fac5f6293819b365d18",
  ".github/workflows/deploy-functions.yml": "64f08ccbef0688368970b2e42dff378f88681a2e4c5ca629e830533a91f92193",
  ".github/workflows/deploy-preflight.yml": "4e5337ef0a4d73937bd8f2a47e37e9f257b87d1549e5afad789fd17fb488734e",
  ".github/workflows/seed-kc-dev.yml": "3449b4a8b7a00bc29e8cf131c7c4e373525fc59de4d8dcad3f662dbdf0ff60ca",
  "scripts/deploy-service-key.mjs": "cfba271c223f9a705247044d36bee6c8d93c30e978aa899fee8e9bccb035585f",
  "scripts/deploy-preflight.mjs": "c86308bf54bc948133cf2757bbf337ca469ad1c0798620d0445aad5ab7f7ce84"
};
const SHA = /^[0-9a-f]{40}$/;
export function verifyPreservationSnapshot(sha, git) {
  if (!SHA.test(sha ?? '')) throw new Error('preservation: missing or invalid immutable SHA');
  for (const [path, expected] of Object.entries(PRESERVATION_FILES)) {
    const bytes = git('show', `${sha}:${path}`);
    if (createHash('sha256').update(bytes).digest('hex') !== expected) {
      throw new Error(`preservation: unreviewed ${path} at ${sha}`);
    }
  }
  // Discover other deploy/seed entrypoints too. A new entrypoint must be reviewed.
  const files = git('ls-tree', '-r', '--name-only', sha).toString().trim().split('\n');
  for (const path of files.filter(p => /^\.github\/workflows\/(?:deploy|seed)[^/]*\.ya?ml$/.test(p) || (/^scripts\/(?:deploy|seed)[^/]*\.mjs$/.test(p) && !p.endsWith('.test.mjs') || /^supabase\/seed\/.*\.(?:sql|sh)$/.test(p)))) {
    const source = git('show', `${sha}:${path}`).toString();
    if (/vault\s*\.\s*(?:create_secret|update_secret)|KC_VAULT_(?:KEY|URL)/i.test(source)) {
      throw new Error(`preservation: Vault write path remains in ${path} at ${sha}`);
    }
  }
}
export function preservationPreflight({ caller, target, git = (...args) => execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024 }) }) {
  verifyPreservationSnapshot(caller, git);
  verifyPreservationSnapshot(target, git);
  return { caller, target, contract: 'vault-preservation-sha256-v1' };
}

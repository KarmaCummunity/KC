// Which branch a PR-like CI run targets, and whether a change that weakens the
// gate needs an owner's approval there (D-195, owner policy of 2026-11-02).
//
// Policy: agents may change CI freely on `dev`, because nothing reaches
// production from `dev` without a release. Every release PR into `main` is
// judged by `main`'s own, older judges, so whatever weakened the gate on `dev`
// since the last release surfaces there and passes only with an owner's
// approval. Like the other judge modules this runs from the BASE commit's copy
// of scripts/, so a PR cannot change the rule that judges it.
//
// Fail closed: only the literal branch `dev` is exempt. A missing, unreadable
// or unknown target counts as protected.

import { readFileSync } from 'node:fs';

/** Branches on which gate-weakening changes need no owner approval. */
export const FREE_BRANCHES = new Set(['dev']);

const HEADS = 'refs/heads/';

/** `refs/heads/dev` and `dev` both give `dev`; null stays null. */
function branchName(ref) {
  if (!ref) return null;
  return ref.startsWith(HEADS) ? ref.slice(HEADS.length) : ref;
}

/** The base ref recorded in the event payload file GitHub gives every step. */
function payloadBaseRef(env) {
  if (!env.GITHUB_EVENT_PATH) return null;
  try {
    const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
    return event.pull_request?.base?.ref ?? event.merge_group?.base_ref ?? null;
  } catch {
    return null;
  }
}

/**
 * The branch this run's change would land on: `BASE_REF` when the workflow
 * passes it (it may be a full ref for merge groups), else the event payload.
 * Null when neither is available.
 * @param {Record<string, string | undefined>} env
 * @returns {string | null}
 */
export function targetBranch(env) {
  return branchName(env.BASE_REF) ?? branchName(payloadBaseRef(env));
}

/**
 * Whether a gate-weakening change in this run needs an owner's approval:
 * everything except a run that targets an exempt branch.
 * @param {Record<string, string | undefined>} env
 * @returns {boolean}
 */
export function ownerApprovalRequired(env) {
  const branch = targetBranch(env);
  return branch === null || !FREE_BRANCHES.has(branch);
}

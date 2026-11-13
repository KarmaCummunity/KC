/**
 * FSM kernel — a pure, closed transition graph shared by every status lifecycle.
 *
 * A machine is a closed set of states plus the legal moves between them. This module
 * answers one question: "is this move legal for this caller?". It has no side effects
 * and takes no predicate callbacks; a use case that depends on other rows (free seats,
 * a time window) checks them before asking the kernel about the edge.
 *
 * The same graph is mirrored row for row in Postgres (`fsm_state` / `fsm_edge`, read by
 * `fsm_assert_transition`). The infrastructure contract test fails CI when they differ.
 * Design: `docs/superpowers/specs/2026-11-09-fsm-kernel-design.md`.
 */
import { ValidationError } from '../errors';
import { TransitionError, type TransitionErrorCode } from './TransitionError';

/**
 * One legal move. Omitted `roles` means any caller may make it; a listed `roles` array
 * restricts it to those roles (fail closed: a caller with no role is rejected).
 */
export type FsmEdge<S extends string, R extends string> = {
  readonly from: S;
  readonly to: S;
  readonly roles?: readonly R[];
};

/** A registered lifecycle. `id` is the `machine_id` of its rows in the SQL catalog. */
export type FsmMachine<S extends string, R extends string> = {
  readonly id: string;
  readonly states: readonly S[];
  readonly edges: readonly FsmEdge<S, R>[];
};

/** `changed: false` is a same-status write: legal, and a no-op for the caller. */
export type TransitionOk = { readonly ok: true; readonly changed: boolean };
export type TransitionFail = { readonly ok: false; readonly code: TransitionErrorCode };
export type TransitionAnswer = TransitionOk | TransitionFail;

/** Same alphabet as a Postgres identifier, so the id can be stored and grepped as-is. */
const MACHINE_ID = /^[a-z][a-z0-9_]*$/;

function assertUniqueStates(states: readonly string[]): ReadonlySet<string> {
  if (states.length === 0) throw new ValidationError('states must not be empty', 'states');
  const known = new Set<string>();
  for (const state of states) {
    if (known.has(state)) throw new ValidationError(`duplicate state ${state}`, 'states');
    known.add(state);
  }
  return known;
}

/** An empty list would mean "nobody may move", which is a deleted edge, not a role list. */
function assertRoles(roles: readonly string[]): void {
  if (roles.length === 0) throw new ValidationError('omit roles instead of an empty list', 'roles');
  const seen = new Set<string>();
  for (const role of roles) {
    // `''` is the SQL catalog's marker for an unrestricted edge, so it cannot be a role name.
    if (role === '') throw new ValidationError('role must not be an empty string', 'roles');
    if (seen.has(role)) throw new ValidationError(`duplicate role ${role}`, 'roles');
    seen.add(role);
  }
}

/**
 * Validates a machine declaration at module load and returns it unchanged.
 * Throws `ValidationError` on an invalid id, an empty or repeated state list, an edge to an
 * unknown state, a repeated `(from, to)` pair, or an empty / repeated role list.
 */
export function defineMachine<S extends string, R extends string>(
  machine: FsmMachine<S, R>,
): FsmMachine<S, R> {
  if (!MACHINE_ID.test(machine.id)) throw new ValidationError(`invalid machine id ${machine.id}`, 'id');
  const known = assertUniqueStates(machine.states);
  const pairs = new Set<string>();
  for (const edge of machine.edges) {
    const pair = `${edge.from}->${edge.to}`;
    if (!known.has(edge.from) || !known.has(edge.to)) {
      throw new ValidationError(`unknown status on ${pair}`, 'edges');
    }
    // Roles for one pair live on one edge, so the SQL primary key cannot collide.
    if (pairs.has(pair)) throw new ValidationError(`duplicate edge ${pair}`, 'edges');
    pairs.add(pair);
    if (edge.roles) assertRoles(edge.roles);
  }
  return machine;
}

/**
 * Answers whether `from → to` is legal for `role`, without throwing.
 * Order matches `fsm_assert_transition`: unknown state, then same-status no-op, then the
 * edge lookup, then the role check.
 */
export function canTransition<S extends string, R extends string>(
  machine: FsmMachine<S, R>,
  from: string,
  to: string,
  role?: R,
): TransitionAnswer {
  const states: readonly string[] = machine.states;
  if (!states.includes(from) || !states.includes(to)) return { ok: false, code: 'unknown_state' };
  if (from === to) return { ok: true, changed: false };
  const edge = machine.edges.find((item) => item.from === from && item.to === to);
  if (!edge) return { ok: false, code: 'illegal_transition' };
  if (edge.roles && (role === undefined || !edge.roles.includes(role))) {
    return { ok: false, code: 'forbidden_role' };
  }
  return { ok: true, changed: true };
}

/**
 * True when some caller may move `from → to`: the edge exists, whatever its roles. Use it for
 * "is this a real move in this lifecycle" questions that do not know the caller (a status
 * badge, a button the server will still authorize). A same-status write is not a move.
 */
export function hasEdge<S extends string, R extends string>(
  machine: FsmMachine<S, R>,
  from: string,
  to: string,
): boolean {
  return machine.edges.some((edge) => edge.from === from && edge.to === to);
}

/**
 * True when `role` may really move `from → to`: the edge exists, the role holds it, and the
 * status changes. Action helpers ask this to decide which buttons a person is offered; a status
 * the app does not know (a newer server) offers nothing.
 */
export function allowsMove<S extends string, R extends string>(
  machine: FsmMachine<S, R>,
  from: string,
  to: S,
  role?: R,
): boolean {
  const answer = canTransition(machine, from, to, role);
  return answer.ok && answer.changed;
}

/** Same answer as `canTransition`, but throws `TransitionError` when the move is not legal. */
export function assertTransition<S extends string, R extends string>(
  machine: FsmMachine<S, R>,
  from: string,
  to: string,
  role?: R,
): TransitionOk {
  const answer = canTransition(machine, from, to, role);
  if (answer.ok) return answer;
  throw new TransitionError(answer.code, {
    machine: machine.id,
    from,
    to,
    ...(role === undefined ? {} : { role }),
  });
}

/** True for a known state that no edge leaves. An unknown state is not terminal. */
export function isTerminal<S extends string, R extends string>(
  machine: FsmMachine<S, R>,
  state: string,
): boolean {
  const states: readonly string[] = machine.states;
  if (!states.includes(state)) return false;
  return !machine.edges.some((edge) => edge.from === state);
}

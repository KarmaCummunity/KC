import { ValidationError } from '../errors';
import { TransitionError, type TransitionErrorCode } from './TransitionError';

export type FsmEdge<S extends string, R extends string> = {
  readonly from: S;
  readonly to: S;
  readonly roles?: readonly R[];
};

export type FsmMachine<S extends string, R extends string> = {
  readonly id: string;
  readonly states: readonly S[];
  readonly edges: readonly FsmEdge<S, R>[];
};

export type TransitionOk = { readonly ok: true; readonly changed: boolean };
export type TransitionFail = { readonly ok: false; readonly code: TransitionErrorCode };
export type TransitionAnswer = TransitionOk | TransitionFail;

const MACHINE_ID = /^[a-z][a-z0-9_]*$/;

export function defineMachine<S extends string, R extends string>(
  machine: FsmMachine<S, R>,
): FsmMachine<S, R> {
  if (!MACHINE_ID.test(machine.id)) throw new ValidationError(`invalid machine id ${machine.id}`, 'id');
  if (machine.states.length === 0) throw new ValidationError('states must not be empty', 'states');
  const known = new Set<string>();
  for (const state of machine.states) {
    if (known.has(state)) throw new ValidationError(`duplicate state ${state}`, 'states');
    known.add(state);
  }
  const pairs = new Set<string>();
  for (const edge of machine.edges) {
    if (!known.has(edge.from) || !known.has(edge.to)) {
      throw new ValidationError(`unknown status on ${edge.from}->${edge.to}`, 'edges');
    }
    const pair = `${edge.from}->${edge.to}`;
    if (pairs.has(pair)) throw new ValidationError(`duplicate edge ${pair}`, 'edges');
    pairs.add(pair);
    if (!edge.roles) continue;
    if (edge.roles.length === 0) throw new ValidationError('omit roles instead of an empty list', 'roles');
    const roles = new Set<string>();
    for (const role of edge.roles) {
      if (roles.has(role)) throw new ValidationError(`duplicate role ${role}`, 'roles');
      roles.add(role);
    }
  }
  return machine;
}

export function canTransition<S extends string, R extends string>(
  machine: FsmMachine<S, R>,
  from: string,
  to: string,
  role?: R,
): TransitionAnswer {
  const known = new Set<string>(machine.states);
  if (!known.has(from) || !known.has(to)) return { ok: false, code: 'unknown_state' };
  if (from === to) return { ok: true, changed: false };
  const edge = machine.edges.find((item) => item.from === from && item.to === to);
  if (!edge) return { ok: false, code: 'illegal_transition' };
  if (!edge.roles) return { ok: true, changed: true };
  if (role === undefined || !edge.roles.includes(role)) return { ok: false, code: 'forbidden_role' };
  return { ok: true, changed: true };
}

export function assertTransition<S extends string, R extends string>(
  machine: FsmMachine<S, R>,
  from: string,
  to: string,
  role?: R,
): TransitionOk {
  const answer = canTransition(machine, from, to, role);
  if (!answer.ok) {
    const details: { machine: string; from: string; to: string; role?: string } = {
      machine: machine.id, from, to,
    };
    if (role !== undefined) details.role = role;
    throw new TransitionError(answer.code, details);
  }
  return answer;
}

export function isTerminal<S extends string, R extends string>(
  machine: FsmMachine<S, R>,
  state: string,
): boolean {
  if (!machine.states.some((item) => item === state)) return false;
  return !machine.edges.some((edge) => edge.from === state);
}

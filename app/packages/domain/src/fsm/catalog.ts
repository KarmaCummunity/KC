import type { FsmMachine } from './machine';
import { adminTaskMachine } from './machines/adminTask';

export const FSM_MACHINES: readonly FsmMachine<string, string>[] = [adminTaskMachine];

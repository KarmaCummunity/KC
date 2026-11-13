// FR-ADMIN-031 — the Demo data screen's use cases: read the status, delete all demo data, and
// restore it. Wipe and restore call the stepped RPC until it reports done, reporting each
// phase to the caller for a progress label.
import {
  DEMO_DATA_MAX_STEPS,
  DemoDataError,
  MIN_DEMO_PASSWORD_LENGTH,
  type DemoDataSeedResult,
  type DemoDataStatus,
  type DemoDataStep,
  type DemoDataWipeResult,
} from '@kc/domain';
import type { IDemoDataRepository } from './IDemoDataRepository';

export type DemoDataProgress = (progressKey: string) => void;

/**
 * Calls `step` until it answers done. The first call may carry extra input (the password);
 * the rest never do. Each answered phase is reported through `onProgress`.
 */
async function runSteps<R>(
  step: (first: boolean) => Promise<DemoDataStep<R>>,
  onProgress?: DemoDataProgress,
): Promise<R> {
  // A stalled operation of the same kind resumes where it stopped, so the bound is twice the
  // longest list of phases.
  for (let i = 0; i < DEMO_DATA_MAX_STEPS * 2; i += 1) {
    const answer = await step(i === 0);
    if (answer.progressKey) onProgress?.(answer.progressKey);
    if (answer.done) {
      if (answer.result === null) throw new DemoDataError('incomplete');
      return answer.result;
    }
  }
  throw new DemoDataError('incomplete');
}

export class GetDemoDataStatusUseCase {
  constructor(private readonly repo: IDemoDataRepository) {}
  execute(): Promise<DemoDataStatus> {
    return this.repo.getStatus();
  }
}

export class WipeDemoDataUseCase {
  constructor(private readonly repo: IDemoDataRepository) {}
  execute(onProgress?: DemoDataProgress): Promise<DemoDataWipeResult> {
    return runSteps(() => this.repo.wipeStep(), onProgress);
  }
}

export class RestoreDemoDataUseCase {
  constructor(private readonly repo: IDemoDataRepository) {}
  /** `password` is needed only when none is saved (AC9); a short one is refused before any call. */
  execute(password?: string, onProgress?: DemoDataProgress): Promise<DemoDataSeedResult> {
    if (password !== undefined && password.length < MIN_DEMO_PASSWORD_LENGTH) {
      return Promise.reject(new DemoDataError('password_too_short'));
    }
    return runSteps((first) => this.repo.seedStep(first ? password : undefined), onProgress);
  }
}

import type { IUserActivityRepository } from '../ports/IUserActivityRepository';

/** Records that the signed-in user opened the app today (KC#1058). */
export class RecordActiveDayUseCase {
  constructor(private readonly repo: IUserActivityRepository) {}

  execute(): Promise<void> {
    return this.repo.recordActiveDay();
  }
}

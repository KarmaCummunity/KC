import { type DynamicModule, Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { SCHEDULED_JOBS, type ScheduledJob, type ScheduledJobSet } from './scheduledJob';

@Module({})
export class JobsModule {
  /** @param set Every job the server runs. Needs the configuration and port clients modules (both global). */
  static forRoot(set: ScheduledJobSet): DynamicModule {
    return {
      module: JobsModule,
      controllers: [JobsController],
      providers: [
        ...set.providers,
        ...set.jobs,
        // Collects the job instances into the one list the controller indexes.
        { provide: SCHEDULED_JOBS, useFactory: (...jobs: ScheduledJob[]) => jobs, inject: [...set.jobs] },
      ],
    };
  }
}

import { type DynamicModule, Module } from '@nestjs/common';
import { createRemoteJWKSet } from 'jose';
import { GOOGLE_IDENTITY_KEYS, GOOGLE_IDENTITY_KEYS_URL, JobCaller } from './jobCaller';
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
        JobCaller,
        // Fetched on first use and cached; a server that never sees an identity token never asks for them.
        { provide: GOOGLE_IDENTITY_KEYS, useFactory: () => createRemoteJWKSet(new URL(GOOGLE_IDENTITY_KEYS_URL)) },
        ...set.providers,
        ...set.jobs,
        // Collects the job instances into the one list the controller indexes.
        { provide: SCHEDULED_JOBS, useFactory: (...jobs: ScheduledJob[]) => jobs, inject: [...set.jobs] },
      ],
    };
  }
}

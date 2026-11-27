import { Inject, Injectable } from '@nestjs/common';
import type { JobReport, ScheduledJob } from '../../platform/jobs/scheduledJob';
import { APP_LOGGER, type AppLogger } from '../../platform/logging/appLogger';
import { PortClients } from '../../platform/ports/portClients';
import { StorageAdmin } from '../../platform/storage/storageAdmin';
import { jobsPerRun, type MediaStorage, processPostMedia } from './processPostMedia';

const BUCKET = 'post-images';
/** A sanitized copy never changes under its name (each attempt writes its own), so it may be cached for good. */
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * The worker that makes the sanitized copy of each new post photo (KC#2316),
 * on KC's own storage (ADR-012). Ported from
 * `supabase/functions/process-post-media`; what a run does and why is in
 * `processPostMedia.ts`.
 */
@Injectable()
export class ProcessPostMediaJob implements ScheduledJob {
  readonly name = 'process-post-media';

  constructor(
    @Inject(PortClients) private readonly clients: PortClients,
    @Inject(StorageAdmin) private readonly files: StorageAdmin,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  /**
   * @param input `{ limit? }`: jobs to claim in this run, 1 to 5 (default 3).
   * @returns `{ claimed, outcomes }`, the outcome of each claimed job by media id.
   * @throws ClaimFailedError when the database could not hand out a job.
   */
  async run(input: Readonly<Record<string, unknown>>): Promise<JobReport> {
    const client = this.clients.serviceClient();
    const run = await processPostMedia(
      {
        rpc: async (fn, args, signal) => {
          const { data, error } = await client.rpc(fn as never, args as never).abortSignal(signal);
          return { data, error: error ? { message: error.message } : null };
        },
        storage: this.mediaStorage(),
        log: (level, step, mediaId, reason) => this.logger[level]({ step, mediaId, reason }, 'post media processing'),
      },
      jobsPerRun(input.limit),
    );
    return { ...run };
  }

  /**
   * The worker's file port on KC's store. The store's own requests are not
   * abortable here; the worker's deadlines still end its wait, and an upload
   * that lands late is removed by the attempt's clean-up or the reconciliation.
   */
  private mediaStorage(): MediaStorage {
    return {
      download: (key, maxBytes) => this.files.read(BUCKET, key, maxBytes),
      upload: async (key, bytes, contentType) => {
        const stored = await this.files.write(BUCKET, key, bytes, { contentType, cacheControl: IMMUTABLE_CACHE_CONTROL });
        if (!stored) throw new Error('The resource already exists');
      },
      remove: (keys) => this.files.remove(BUCKET, keys),
    };
  }
}

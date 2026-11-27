import { Inject, Injectable } from '@nestjs/common';
import { IdentityDatabase } from '../../platform/database/identityDatabase';
import { batchLimit, type JobReport, type ScheduledJob } from '../../platform/jobs/scheduledJob';
import { APP_LOGGER, type AppLogger } from '../../platform/logging/appLogger';
import { OBJECT_STORE, type ObjectStore } from '../../platform/storage/objectStore';
import { NoObjectStoreError, StorageAdmin } from '../../platform/storage/storageAdmin';
import { createCopyIndex } from './copyIndex';
import { type CopyCursor, type CopySource, copyStoredFiles } from './copyStoredFiles';

/** Injection token of the `CopySource`, or of null when this server was given none. */
export const COPY_SOURCE = Symbol('COPY_SOURCE');

/** Files one run handles when the caller names no number, and the most it may ask for. */
const DEFAULT_FILES_PER_RUN = 100;
const MOST_FILES_PER_RUN = 1000;

/** The copy was asked of a server that was not told where the files live today. */
export class NoCopySourceError extends Error {
  constructor() {
    super('this server has no copy source configured');
    this.name = 'NoCopySourceError';
  }
}

/**
 * The cursor a caller sent, when it is one.
 * @returns null for anything else, which starts the pass from the first bucket.
 */
export function cursorOf(value: unknown): CopyCursor | null {
  const { bucket, after } = (value ?? {}) as Record<string, unknown>;
  if (typeof bucket !== 'string' || (after !== null && typeof after !== 'string')) return null;
  return { bucket, after };
}

/**
 * Copies KC's existing files into its own store and proves each copy
 * (ADR-012 section 6); the rules are in `copyStoredFiles.ts`. One run handles
 * a bounded number of files and answers where it stopped: the caller sends
 * that back as `from` until the answer's `next` is null. The whole pass can
 * be repeated at any time, and is, until the app is switched to KC's store.
 */
@Injectable()
export class CopyStoredFilesJob implements ScheduledJob {
  readonly name = 'copy-stored-files';

  constructor(
    @Inject(OBJECT_STORE) private readonly store: ObjectStore | null,
    @Inject(COPY_SOURCE) private readonly source: CopySource | null,
    @Inject(StorageAdmin) private readonly files: StorageAdmin,
    @Inject(IdentityDatabase) private readonly database: IdentityDatabase,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  /**
   * @param input `from`: the `next` of the run before; `limit`: files to handle (default 100, at most 1000).
   * @returns `{ scanned, verified, copied, replaced, destinationOnly, absent, failed, next }`.
   * @throws NoObjectStoreError, NoCopySourceError
   */
  async run(input: Readonly<Record<string, unknown>>): Promise<JobReport> {
    if (!this.store) throw new NoObjectStoreError();
    if (!this.source) throw new NoCopySourceError();
    const summary = await copyStoredFiles(
      {
        index: createCopyIndex(this.database),
        source: this.source,
        destination: this.store,
        report: (problem, file) => this.logger.warn({ err: problem, ...file }, 'stored file not copied'),
      },
      { buckets: await this.files.buckets(), from: cursorOf(input.from), limit: batchLimit(input.limit, DEFAULT_FILES_PER_RUN, MOST_FILES_PER_RUN) },
    );
    return { ...summary };
  }
}

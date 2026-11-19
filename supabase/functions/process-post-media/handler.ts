import { isServiceRoleRequest, serviceRoleRequiredResponse } from '../_shared/serviceRoleGuard.ts';

export interface MediaJob {
  id: string;
  storage_key: string;
  mime_type: string;
  attempts: number;
}
export interface MediaDeps {
  serviceRoleKey: string | string[];
  claim(): Promise<MediaJob[]>;
  finish(job: MediaJob, ok: boolean): Promise<boolean>;
  download(path: string): Promise<Uint8Array>;
  encode(bytes: Uint8Array, mime: string): Promise<{ original: Uint8Array; thumb: Uint8Array }>;
  upload(path: string, bytes: Uint8Array, mime: string): Promise<void>;
  report(error: unknown): Promise<void>;
}

export function thumbnailPath(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot > path.lastIndexOf('/') ? `${path.slice(0, dot)}-thumb${path.slice(dot)}` : `${path}-thumb`;
}

export function createMediaHandler(deps: MediaDeps) {
  return async (req: Request): Promise<Response> => {
    const json = (body: unknown, status = 200) => Response.json(body, { status });
    if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
    if (!isServiceRoleRequest(req, deps.serviceRoleKey)) return serviceRoleRequiredResponse();
    const stats = { ready: 0, failed: 0, retry: 0, errors: 0 };
    try {
      const jobs = await deps.claim();
      for (const job of jobs) {
        try {
          const bytes = await deps.download(job.storage_key);
          if (!bytes.length || bytes.length > 8388608) throw new Error('invalid_image_size');
          const encoded = await deps.encode(bytes, job.mime_type);
          // A pre-existing thumbnail is not proof of processing: both objects must
          // be server encoded. Status remains pending if either upload fails.
          await deps.upload(job.storage_key, encoded.original, job.mime_type);
          await deps.upload(thumbnailPath(job.storage_key), encoded.thumb, job.mime_type);
          if (await deps.finish(job, true)) stats.ready++;
        } catch (error) {
          stats.errors++;
          await deps.report(error);
          if (await deps.finish(job, false)) stats.failed++;
          else stats.retry++;
        }
      }
      return json({ ok: true, ...stats });
    } catch (error) {
      await deps.report(error);
      return json({ ok: false, error: 'media_processing_unavailable', ...stats }, 500);
    }
  };
}

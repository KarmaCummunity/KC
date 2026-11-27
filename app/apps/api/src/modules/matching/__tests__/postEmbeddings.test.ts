import { describe, expect, it } from 'vitest';
import { type ClaimedEmbeddingJob, embedClaimedPosts, embedText, stubEmbed } from '../postEmbeddings';

const JOB: ClaimedEmbeddingJob = { job_id: 'j1', post_id: 'p1', model: 'text-embedding-3-small', title: 'Sofa', summary: 'blue', details: { item_condition: 'Good' } };

/** The batch over a recording database; `storeRefusal` is what `embedding_job_store` answers. */
function setup(jobs: ClaimedEmbeddingJob[], storeRefusal: string | null = null) {
  const claimed: number[] = [];
  const stored: Array<{ jobId: string; embedding: number[]; model: string }> = [];
  const failed: Array<{ jobId: string; reason: string }> = [];
  const run = (limit = 20) =>
    embedClaimedPosts(limit, {
      claim: (asked) => {
        claimed.push(asked);
        return Promise.resolve(jobs);
      },
      store: (jobId, embedding, model) => {
        stored.push({ jobId, embedding, model });
        return Promise.resolve(storeRefusal);
      },
      fail: (jobId, reason) => {
        failed.push({ jobId, reason });
        return Promise.resolve();
      },
    });
  return { run, claimed, stored, failed };
}

describe('embedClaimedPosts', () => {
  it('claims with the limit it was given and does nothing more when no job is waiting', async () => {
    const { run, claimed, stored } = setup([]);

    expect(await run(5)).toEqual({ processed: 0 });
    expect(claimed).toEqual([5]);
    expect(stored).toEqual([]);
  });

  it('stores each claimed job\'s vector with its model, or the placeholder model when the job names none', async () => {
    const { run, stored } = setup([JOB, { ...JOB, job_id: 'j2', model: null }]);

    expect(await run()).toEqual({ processed: 2 });
    expect(stored[0]).toEqual({ jobId: 'j1', embedding: stubEmbed(embedText(JOB)), model: 'text-embedding-3-small' });
    expect(stored[1]?.model).toBe('stub-v1');
  });

  it('records the failure of a job whose vector the database refused, and goes on', async () => {
    const { run, failed } = setup([JOB, { ...JOB, job_id: 'j2' }], 'boom');

    expect(await run()).toEqual({ processed: 0 });
    expect(failed).toEqual([
      { jobId: 'j1', reason: 'boom' },
      { jobId: 'j2', reason: 'boom' },
    ]);
  });

  it('rejects when the jobs cannot be claimed', async () => {
    const failing = embedClaimedPosts(20, { claim: () => Promise.reject(new Error('down')), store: () => Promise.resolve(null), fail: () => Promise.resolve() });

    await expect(failing).rejects.toThrow('down');
  });
});

describe('the embedded text and the placeholder vector', () => {
  it('builds the text from title, summary and details, cut at 8,000 characters', () => {
    expect(embedText(JOB)).toBe('Sofa\nblue\n{"item_condition":"Good"}');
    expect(embedText({ title: 'T', summary: null, details: null })).toBe('T\n\n{}');
    expect(embedText({ title: 'x'.repeat(9000), summary: null, details: {} })).toHaveLength(8000);
  });

  it('gives a unit vector of 1,536 dimensions, the same for the same text, and a finite one for no text', () => {
    const vector = stubEmbed('abc');

    expect(vector).toHaveLength(1536);
    expect(Math.round(vector.reduce((sum, value) => sum + value * value, 0) * 1e6)).toBe(1e6);
    expect(stubEmbed('abc')).toEqual(vector);
    expect(stubEmbed('').every((value) => value === 0)).toBe(true);
  });
});

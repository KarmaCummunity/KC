// FR-KNOW-004 AC1 (#2479): recurring lesson series use cases over an in-memory port double.
import { describe, expect, it } from 'vitest';
import type { KnowledgeSlotSeries, KnowledgeSlotSeriesStatus } from '@kc/domain';
import type { IKnowledgeSlotSeriesRepository } from '../../ports/IKnowledgeSlotSeriesRepository';
import { GetKnowledgeSlotSeriesUseCase, SetKnowledgeSlotSeriesStatusUseCase } from '../KnowledgeSlotSeriesUseCases';

const SERIES: KnowledgeSlotSeries = {
  postId: 'p1',
  weekdays: [0, 2],
  startTime: '18:00',
  durationMinutes: 60,
  capacity: 2,
  endsOn: null,
  status: 'active',
};

class FakeSeriesRepository implements IKnowledgeSlotSeriesRepository {
  moves: Array<[string, KnowledgeSlotSeriesStatus]> = [];
  async getForPost(postId: string) {
    return postId === SERIES.postId ? SERIES : null;
  }
  async setStatus(postId: string, status: KnowledgeSlotSeriesStatus) {
    this.moves.push([postId, status]);
  }
}

describe('knowledge slot series use cases', () => {
  it('reads the series of an offer, null for a one-off offer', async () => {
    const get = new GetKnowledgeSlotSeriesUseCase(new FakeSeriesRepository());
    await expect(get.execute('p1')).resolves.toEqual(SERIES);
    await expect(get.execute('p2')).resolves.toBeNull();
  });

  it('passes a move to the port', async () => {
    const repo = new FakeSeriesRepository();
    await new SetKnowledgeSlotSeriesStatusUseCase(repo).execute('p1', 'paused');
    expect(repo.moves).toEqual([['p1', 'paused']]);
  });
});

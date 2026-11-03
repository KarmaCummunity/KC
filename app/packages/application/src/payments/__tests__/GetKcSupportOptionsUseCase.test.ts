import { describe, it, expect } from 'vitest';
import type { KcSupportChannel } from '@kc/domain';
import { GetKcSupportOptionsUseCase } from '../GetKcSupportOptionsUseCase';
import { KcSupportChannelsError } from '../KcSupportChannelsError';
import type { IKcSupportChannelsRepository } from '../../ports/IKcSupportChannelsRepository';

const bit: KcSupportChannel = { kind: 'bit', url: 'https://bit.example/pay', providerLabel: 'Bit' };
const once: KcSupportChannel = { kind: 'card_one_time', url: 'https://pay.grow.link/once', providerLabel: 'Grow' };

function repoReturning(result: KcSupportChannel[] | Error): IKcSupportChannelsRepository {
  return {
    listActiveChannels: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

describe('GetKcSupportOptionsUseCase', () => {
  it('builds donor options from the server-configured channels', async () => {
    const useCase = new GetKcSupportOptionsUseCase(repoReturning([bit, once]));
    expect(await useCase.execute()).toEqual({ oneTime: [once], standingOrder: null });
  });

  it('propagates a load failure instead of inventing payment links', async () => {
    const failing = repoReturning(new KcSupportChannelsError('network', 'offline'));
    await expect(new GetKcSupportOptionsUseCase(failing).execute()).rejects.toBeInstanceOf(
      KcSupportChannelsError,
    );
  });

  it('returns empty options when the operator disabled every channel', async () => {
    const useCase = new GetKcSupportOptionsUseCase(repoReturning([]));
    expect(await useCase.execute()).toEqual({ oneTime: [], standingOrder: null });
  });
});

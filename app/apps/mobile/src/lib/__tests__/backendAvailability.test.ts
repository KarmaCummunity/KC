import { describe, expect, it } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import i18n from '../../i18n';
import {
  isBackendUnavailable, listOrEmpty, listUnavailableMessage, notAvailableMessage, runAction, valueOrNull,
} from '../backendAvailability';

const unavailable = () => Promise.reject(new BackendUnavailableError('rpc:feed_page'));
const broken = () => Promise.reject(new Error('timeout'));

describe('degrade rule helpers', () => {
  it('a list becomes empty when the backend object is missing', async () => {
    expect(await listOrEmpty(unavailable)).toEqual([]);
    expect(await listOrEmpty(async () => [1, 2])).toEqual([1, 2]);
  });

  it('an optional value becomes null when the backend object is missing', async () => {
    expect(await valueOrNull(unavailable)).toBeNull();
    expect(await valueOrNull(async () => 'x')).toBe('x');
  });

  it('an action reports "unavailable" instead of throwing', async () => {
    expect(await runAction(unavailable)).toEqual({ status: 'unavailable' });
    expect(await runAction(async () => 7)).toEqual({ status: 'done', value: 7 });
  });

  it('every other failure stays an error: it is never turned into an empty list', async () => {
    await expect(listOrEmpty(broken)).rejects.toThrow('timeout');
    await expect(valueOrNull(broken)).rejects.toThrow('timeout');
    await expect(runAction(broken)).rejects.toThrow('timeout');
    expect(isBackendUnavailable(new Error('x'))).toBe(false);
  });

  it('the messages exist in Hebrew and English', () => {
    for (const lng of ['he', 'en']) {
      for (const key of ['notAvailableTitle', 'notAvailableYet', 'listUnavailable']) {
        expect(i18n.getResource(lng, 'translation', `backend.${key}`)).toEqual(expect.any(String));
      }
    }
    expect(notAvailableMessage()).toEqual(expect.any(String));
    expect(listUnavailableMessage()).toEqual(expect.any(String));
  });
});

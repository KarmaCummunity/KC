import { describe, expect, it, vi } from 'vitest';
import type { PortTransport } from '../portTransport';
import { createRemotePort, PortMethodNotRoutedError } from '../remotePort';

interface Library {
  readonly kind: string;
  find(id: string): Promise<string | null>;
  list(limit: number, cursor?: string): Promise<string[]>;
  upload(file: string): Promise<void>;
}

function recordingTransport(result: unknown = 'ok') {
  const call = vi.fn(() => Promise.resolve(result));
  return { transport: { call } as unknown as PortTransport, call };
}

describe('createRemotePort', () => {
  it('forwards a method call to the API with its arguments', async () => {
    const { transport, call } = recordingTransport(['a']);
    const library = createRemotePort<Library>(transport, 'library');

    expect(await library.list(10, 'cursor-1')).toEqual(['a']);
    expect(call).toHaveBeenCalledWith('library', 'list', [10, 'cursor-1']);
  });

  it('gives each method one stable function', () => {
    const library = createRemotePort<Library>(recordingTransport().transport, 'library');

    expect(library.find).toBe(library.find);
    expect(library.find).not.toBe(library.list);
  });

  it('is not mistaken for a promise', async () => {
    const library = createRemotePort<Library>(recordingTransport().transport, 'library');

    expect((library as unknown as { then?: unknown }).then).toBeUndefined();
    await expect(Promise.resolve(library)).resolves.toBe(library);
  });

  it('routes only the listed methods to the API and the rest to the fallback', async () => {
    const { transport, call } = recordingTransport('remote');
    const fallback: Library = {
      kind: 'local',
      find: () => Promise.resolve('local'),
      list: () => Promise.resolve(['local']),
      upload: vi.fn(function (this: Library) {
        // Bound to the fallback, so adapter methods that use `this` keep working.
        expect(this).toBe(fallback);
        return Promise.resolve();
      }),
    };
    const library = createRemotePort<Library>(transport, 'library', { methods: ['find'], fallback });

    expect(await library.find('1')).toBe('remote');
    expect(await library.list(5)).toEqual(['local']);
    await library.upload('file');
    expect(library.kind).toBe('local');
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('fails loudly for a method that is neither served nor covered by a fallback', async () => {
    const library = createRemotePort<Library>(recordingTransport().transport, 'library', { methods: ['find'] });

    await expect(library.upload('file')).rejects.toBeInstanceOf(PortMethodNotRoutedError);
  });
});

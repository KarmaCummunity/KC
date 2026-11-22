// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

/** Every `source` the native image was rendered with, in order, plus its latest error handler. */
const { rendered } = vi.hoisted(() => ({ rendered: { sources: [] as string[], onError: null as null | (() => void) } }));
vi.mock('expo-image', () => ({
  Image: (props: { source: string; onError: () => void }) => {
    rendered.sources.push(props.source);
    rendered.onError = props.onError;
    return null;
  },
}));

import { KCImage } from '../KCImage';

afterEach(() => {
  cleanup();
  rendered.sources = [];
  rendered.onError = null;
});

describe('KCImage', () => {
  it('shows a new uri in the same render: a recycled cell never paints the previous row', () => {
    const view = render(<KCImage uri="https://cdn/a-thumb.jpg" fallbackUri="https://cdn/a.jpg" />);
    view.rerender(<KCImage uri="https://cdn/b-thumb.jpg" fallbackUri="https://cdn/b.jpg" />);
    expect(rendered.sources).toEqual(['https://cdn/a-thumb.jpg', 'https://cdn/b-thumb.jpg']);
  });

  it('falls back once per uri, then reports the error', () => {
    const onError = vi.fn();
    const view = render(<KCImage uri="https://cdn/a-thumb.jpg" fallbackUri="https://cdn/a.jpg" onError={onError} />);
    act(() => rendered.onError?.());
    expect(rendered.sources.at(-1)).toBe('https://cdn/a.jpg');
    act(() => rendered.onError?.());
    expect(onError).toHaveBeenCalledTimes(1);
    // A different photo starts again from its own thumb.
    view.rerender(<KCImage uri="https://cdn/c-thumb.jpg" fallbackUri="https://cdn/c.jpg" onError={onError} />);
    expect(rendered.sources.at(-1)).toBe('https://cdn/c-thumb.jpg');
  });

  it('reports the error directly when there is no distinct fallback, and renders nothing without a uri', () => {
    const onError = vi.fn();
    render(<KCImage uri="https://cdn/a.jpg" fallbackUri="https://cdn/a.jpg" onError={onError} />);
    act(() => rendered.onError?.());
    expect(onError).toHaveBeenCalledTimes(1);
    rendered.sources = [];
    render(<KCImage uri={null} />);
    expect(rendered.sources).toEqual([]);
  });
});

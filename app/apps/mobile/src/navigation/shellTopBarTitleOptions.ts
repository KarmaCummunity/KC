import type { ReactNode } from 'react';

/** Maps a shell title patch to stack `setOptions` fields (`useShellTopBarChrome`). */
export function stackOptionsForShellTopBarTitle(title: ReactNode | undefined): Record<string, unknown> {
  if (title === undefined) return {};
  if (typeof title === 'string') return { title, headerTitle: title };
  return { title: '', headerTitle: () => title };
}

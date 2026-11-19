// Mapped to spec: FR-RESP-006 AC25 — the measuring side of the form scope: the fields in on-screen
// reading order, and a wait for layout to settle before the screen is scrolled.
import { InteractionManager, Platform } from 'react-native';
import { measureFieldPosition, sortByReadingOrder, type FieldPosition } from '../../lib/platform/formFieldOrder';
import type { FormFieldHandle } from './formScope';

export interface OrderedField {
  readonly id: string;
  readonly handle: FormFieldHandle;
  readonly position: FieldPosition;
}

/** Mounted, measurable fields in reading order. */
export async function orderedFields(
  fields: ReadonlyMap<string, FormFieldHandle>,
  onlyFocusable: boolean,
): Promise<OrderedField[]> {
  const entries = [...fields].filter(([, handle]) => !onlyFocusable || handle.isFocusable());
  const measured = await Promise.all(
    entries.map(async ([id, handle]) => ({ id, handle, position: await measureFieldPosition(handle.view()) })),
  );
  return sortByReadingOrder(measured.filter((row): row is OrderedField => row.position !== null));
}

/** Two frames (plus the interaction queue on Android) so layout settles after a focus change or the keyboard closing. */
export function afterLayout(run: () => void): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (Platform.OS === 'android') InteractionManager.runAfterInteractions(run);
      else run();
    });
  });
}

// Mounts the shared closure sheet for "My listings" and refreshes the list when it finishes.
import { useEffect } from 'react';
import { ClosureSheet } from '../closure/ClosureSheet';
import { useClosureStore } from '../../store/closureStore';

interface Props {
  readonly onDone: () => void;
}

export function MyListingsClosureHost({ onDone }: Props) {
  const step = useClosureStore((s) => s.step);
  const initiator = useClosureStore((s) => s.initiator);
  const reset = useClosureStore((s) => s.reset);

  useEffect(() => {
    if (step !== 'done' || initiator !== 'my-listings') return;
    reset();
    onDone();
  }, [step, initiator, reset, onDone]);

  return <ClosureSheet />;
}

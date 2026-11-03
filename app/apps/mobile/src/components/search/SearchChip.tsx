// Filter chip of the search and ride filter sheets and the date/time field.
// A thin adapter over the kit `Chip` (spec 17 §4.1) that keeps the callers' `active` prop.
// Compact `sm`, like every chip in a filter sheet (design-lead call, D99);
// the kit's `hitSlop` keeps the 44pt touch target.
import { Chip } from '../ui/Chip';

interface Props {
  readonly label: string;
  readonly active: boolean;
  readonly onPress: () => void;
}

export function SearchChip({ label, active, onPress }: Props) {
  return <Chip size="sm" label={label} selected={active} onPress={onPress} />;
}

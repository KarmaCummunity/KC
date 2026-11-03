// Filter chip of the admin list screens: the kit `Chip` in the compact admin
// size (spec 17 §4.1 / §4.3), keeping the callers' `active` prop.
import { Chip } from '../ui/Chip';

export interface AdminFilterChipProps {
  readonly label:   string;
  readonly active:  boolean;
  readonly onPress: () => void;
}

export function AdminFilterChip({ label, active, onPress }: AdminFilterChipProps) {
  return <Chip size="sm" label={label} selected={active} onPress={onPress} />;
}

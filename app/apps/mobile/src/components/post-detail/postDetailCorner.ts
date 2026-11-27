import type { ViewStyle } from 'react-native';
import { spacing } from '@kc/ui';
import { absoluteCornerEnd, absoluteCornerStart } from '../../lib/rtlLayout';

/** Top inline-start corner on the post-detail hero (status badge). */
export function heroCornerStart(inset = spacing.base): Pick<ViewStyle, 'left' | 'right' | 'start'> {
  return absoluteCornerStart(inset);
}

/** Bottom inline-end corner on the post-detail hero (type tag). */
export function heroCornerEnd(inset = spacing.base): Pick<ViewStyle, 'left' | 'right' | 'end'> {
  return absoluteCornerEnd(inset);
}

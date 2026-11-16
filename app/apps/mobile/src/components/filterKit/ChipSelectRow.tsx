// Mapped to spec: FR-POST-001 AC6 / FR-FEED-004 / FR-RESP-006 — the one layout for every
// multi-option section (forms and filter sheets): a single line of chips that scrolls sideways.
// No expand control and no wrapping, so a section keeps the same height however many options it has.
import React, { type ReactNode } from 'react';
import { ScrollView, type StyleProp, type ViewStyle } from 'react-native';
import { makeUseStyles, spacing } from '@kc/ui';

export interface ChipSelectRowProps {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly contentContainerStyle?: StyleProp<ViewStyle>;
  readonly testID?: string;
  readonly accessibilityLabel?: string;
}

export function ChipSelectRow({ children, style, contentContainerStyle, testID, accessibilityLabel }: ChipSelectRowProps) {
  const styles = useChipSelectRowStyles();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Taps on a chip must not be swallowed while the keyboard of the field above is open.
      keyboardShouldPersistTaps="handled"
      style={[styles.scroll, style]}
      contentContainerStyle={[styles.gapRow, contentContainerStyle]}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
    >
      {children}
    </ScrollView>
  );
}

const useChipSelectRowStyles = makeUseStyles(() => ({
  scroll: { flexGrow: 0, flexShrink: 0 },
  gapRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
}));

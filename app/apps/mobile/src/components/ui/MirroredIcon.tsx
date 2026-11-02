// Directional icons that read correctly in both layout directions (spec 17 §4.2; FR-RESP-006
// AC4 / AC18; issue #1288).
//
//   <MirroredIcon name="chevron-forward" size={iconSize.md} color={colors.textSecondary} />
//   <MirroredIcon name={useDirectionalBackIcon()} size={iconSize['2xl']} color={tint} />
//
// Ionicons glyphs never flip on their own, so an arrow drawn for left-to-right points the wrong
// way in Hebrew. `MirroredIcon` names the glyph for LTR ("forward" points right) and flips it
// when the layout runs RTL. Non-directional glyphs (search, bell, gear) keep using `Ionicons`.
import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { isLayoutRtl } from '../../lib/rtlLayout';

type IoniconsProps = React.ComponentProps<typeof Ionicons>;

/** The glyph of the "back" affordance per platform, named for LTR (`MirroredIcon` flips it in RTL). */
export type DirectionalBackIcon = 'chevron-back' | 'arrow-back';

/**
 * The platform's "back" glyph: a chevron on iOS (Apple HIG), an arrow on Android (Material 3)
 * and on web. Render it through `MirroredIcon`, which turns it around for Hebrew.
 */
export function useDirectionalBackIcon(): DirectionalBackIcon {
  return Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back';
}

/** An Ionicons glyph named for LTR that mirrors horizontally when the layout runs RTL. */
export function MirroredIcon({ style, ...props }: Readonly<IoniconsProps>) {
  return <Ionicons {...props} style={[style, isLayoutRtl() ? styles.mirrored : null]} />;
}

const styles = StyleSheet.create({
  mirrored: { transform: [{ scaleX: -1 }] },
});

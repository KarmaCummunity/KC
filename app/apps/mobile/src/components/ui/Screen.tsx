// Screen wrapper for the redesigned main-screen idiom (login-style).
// Provides:
//   - SafeAreaView with the warm cream backdrop (theme-aware).
//   - Optional ambient orange blobs behind everything (density configurable).
//   - A single mount point so every main screen looks identical at the edges.
//
// `scroll` is intentional: if the screen already brings its own KcFlashList /
// ScrollView (e.g. feed), pass `scroll={false}` and render the list directly.
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useTheme } from '@kc/ui';
import { AmbientBlobs } from './AmbientBlobs';
import {
  useShellTabBarScrollInset,
  useShellTabBarVisibility,
} from '../../navigation/useShellTabBarVisibility';

interface ScreenProps {
  readonly children: React.ReactNode;
  readonly scroll?: boolean;
  readonly blobs?: 'auth' | 'content' | 'off';
  readonly edges?: readonly Edge[];
  readonly contentContainerStyle?: ViewStyle;
  readonly style?: ViewStyle;
  /**
   * When true (default), reserves bottom padding equal to the floating
   * tab-bar pill height + safe-area on screens where the shell renders the
   * bar. The padding is only applied when the bar is actually visible — on
   * routes that suppress the bar (auth, onboarding, chat conversation) this
   * prop is a no-op even if true. Pass `false` only when the screen owns its
   * own footer (CTA bar, composer) and already reserves space, or when
   * wrapping a `KcFlashList` directly.
   */
  readonly tabBarInset?: boolean;
  /**
   * Set when the screen is rendered inside an Expo Router Stack with
   * `headerShown: true` (native header). The header already consumes the top
   * safe-area; including `'top'` in `edges` would double-pad on notched /
   * Dynamic Island iPhones (FR-RESP-006 AC9).
   */
  readonly hasNativeHeader?: boolean;
  readonly testID?: string;
}

export function Screen({
  children,
  scroll = false,
  blobs = 'off',
  edges,
  contentContainerStyle,
  style,
  tabBarInset = true,
  hasNativeHeader = false,
  testID,
}: ScreenProps) {
  const { colors } = useTheme();
  // Both hooks always called (Rules of Hooks). When the bar is hidden, we
  // skip padding so we don't add phantom 20+76+insets.bottom px on
  // auth / onboarding screens that mount under <Screen>.
  const tabBarVisible = useShellTabBarVisibility();
  const tabBarPad = useShellTabBarScrollInset();

  // Effective edges: caller wins; otherwise default to ['top'] unless a
  // native header already eats the top inset (then default to []).
  const effectiveEdges: readonly Edge[] =
    edges ?? (hasNativeHeader ? [] : ['top']);

  // Memoized so KcFlashList / ScrollView don't see a fresh array on every parent
  // re-render — FR-RESP-006 AC15.
  const scrollContentStyle = useMemo<ViewStyle[]>(() => {
    const out: ViewStyle[] = [staticStyles.scrollContent];
    if (contentContainerStyle) out.push(contentContainerStyle);
    if (tabBarInset && scroll && tabBarVisible) {
      out.push({ paddingBottom: tabBarPad });
    }
    return out;
  }, [contentContainerStyle, tabBarInset, scroll, tabBarVisible, tabBarPad]);

  const body = scroll ? (
    <ScrollView
      style={staticStyles.flex}
      contentContainerStyle={scrollContentStyle}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[staticStyles.flex, contentContainerStyle]}>{children}</View>
  );

  return (
    <SafeAreaView
      testID={testID}
      style={[staticStyles.container, { backgroundColor: colors.surfaceCream }, style]}
      edges={effectiveEdges}
    >
      {blobs !== 'off' && <AmbientBlobs density={blobs} />}
      {body}
    </SafeAreaView>
  );
}

const staticStyles = StyleSheet.create({
  // RN-Web + `dir=rtl`: without explicit width the tree can shrink-wrap to
  // content and hug the inline-start edge, leaving empty space on the other side.
  container: {
    flex: 1,
    width: '100%',
    alignSelf: 'stretch',
  },
  flex: { flex: 1, width: '100%', alignSelf: 'stretch', minWidth: 0 },
  scrollContent: { flexGrow: 1, alignSelf: 'stretch', minWidth: '100%' },
});
// Shared stack header for world screens (#1632): the app TopBar (chat, KC logo,
// notifications, settings) stays on every world screen and the screens inside it.
// The back button and the screen title sit in a slim row that is part of the
// same header, so back navigation keeps working. Layout uses logical
// start/end flow only, so it mirrors correctly in Hebrew (RTL) and English (LTR).
import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { makeUseStyles, spacing, typography, useTheme, Text } from '@kc/ui';
import { TopBar } from '../components/TopBar';
import { BackButton } from '../components/BackButton';

export interface TopBarStackHeaderProps {
  title?: string;
  showBack: boolean;
  right?: React.ReactNode;
}

export function TopBarStackHeader({ title, showBack, right }: Readonly<TopBarStackHeaderProps>) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={['top']} style={styles.root} testID="topbar-stack-header">
      <TopBar />
      {showBack || title || right ? (
        <View style={styles.row}>
          <View style={styles.side}>{showBack ? <BackButton tintColor={colors.primary} /> : null}</View>
          <Text style={styles.title} numberOfLines={1}>
            {title ?? ''}
          </Text>
          <View style={[styles.side, styles.sideEnd]}>{right}</View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

type HeaderTitleOption = string | ((props: { children: string; tintColor?: string }) => React.ReactNode) | undefined;

interface StackHeaderArgs {
  navigation: { canGoBack: () => boolean };
  route: { name: string };
  options: {
    headerTitle?: HeaderTitleOption;
    title?: string;
    headerRight?: (props: { tintColor?: string; canGoBack?: boolean }) => React.ReactNode;
  };
}

/** Plain-string title for the header row; function titles fall back to `title`. */
export function resolveStackHeaderTitle(options: StackHeaderArgs['options']): string | undefined {
  if (typeof options.headerTitle === 'string') return options.headerTitle;
  return options.title;
}

/** `header` screen option: renders the shared TopBar header for a stack screen. */
export function topBarStackHeader({ navigation, options }: StackHeaderArgs) {
  const canGoBack = navigation.canGoBack();
  return (
    <TopBarStackHeader
      title={resolveStackHeaderTitle(options)}
      showBack={canGoBack}
      right={options.headerRight?.({ canGoBack })}
    />
  );
}

/** Spread into a Stack's screen options to show the shared TopBar header. */
export const topBarStackHeaderOptions = {
  headerShown: true,
  header: topBarStackHeader,
} as const;

const useStyles = makeUseStyles(({ colors }) => ({
  root: { backgroundColor: colors.surfaceCream },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xs,
    minHeight: 40,
  },
  side: { minWidth: 44, flexDirection: 'row' as const, alignItems: 'center' as const },
  sideEnd: { justifyContent: 'flex-end' as const },
  title: {
    ...typography.h4,
    flex: 1,
    textAlign: 'center' as const,
    color: colors.textPrimary,
  },
}));

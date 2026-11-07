// Shared stack header for world screens (#1632): the app TopBar (chat, admin portal,
// notifications, settings) stays on every world screen and the screens inside it.
// The screen title replaces the logo and the back button sits at the reading start, all in
// the one TopBar row, so the header takes no extra height. Layout uses logical
// start/end flow only, so it mirrors correctly in Hebrew (RTL) and English (LTR).
import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { makeUseStyles, useTheme } from '@kc/ui';
import { TopBar } from '../components/TopBar';
import { BackButton } from '../components/BackButton';

export interface TopBarStackHeaderProps {
  /** A plain title, or a node (e.g. a world's screens-menu button). */
  title?: React.ReactNode;
  showBack: boolean;
  right?: React.ReactNode;
}

/** One row: the screen title sits in the TopBar in place of the logo, so it takes no extra height. */
export function TopBarStackHeader({ title, showBack, right }: Readonly<TopBarStackHeaderProps>) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={['top']} style={styles.root} testID="topbar-stack-header">
      <TopBar
        title={title}
        startIcon={showBack ? <BackButton tintColor={colors.primary} /> : null}
        extraIcon={right}
      />
    </SafeAreaView>
  );
}

type HeaderTitleOption =
  | string
  | React.ReactElement
  | ((props: { children: string; tintColor?: string }) => React.ReactNode)
  | undefined;

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

/** Center slot for TopBar — string, element, or native-stack function title. */
export function resolveTopBarCenterTitle(options: StackHeaderArgs['options']): React.ReactNode {
  const { headerTitle } = options;
  if (typeof headerTitle === 'function') {
    return headerTitle({ children: resolveStackHeaderTitle(options) ?? '' });
  }
  if (typeof headerTitle === 'string') return headerTitle;
  if (headerTitle !== undefined && headerTitle !== null) return headerTitle;
  return resolveStackHeaderTitle(options);
}

export { stackOptionsForShellTopBarTitle } from './shellTopBarTitleOptions';

/** `header` screen option: renders the shared TopBar header for a stack screen. */
export function topBarStackHeader({ navigation, options }: StackHeaderArgs) {
  const canGoBack = navigation.canGoBack();
  return (
    <TopBarStackHeader
      title={resolveTopBarCenterTitle(options)}
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
}));

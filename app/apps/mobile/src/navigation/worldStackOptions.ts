// Shared native-stack options for donation world stacks (rides, knowledge, …):
// header-less stack with fade, plus a detail header with the icon-only back button.
import { useTheme } from '@kc/ui';
import { nativeStackHeaderLeftIconOnly } from './nativeHeaderIconOnly';
import { nestedStackGestureOptions } from './nestedStackGestureOptions';
import { topBarStackHeader } from './TopBarStackHeader';

export function useWorldStackOptions() {
  const { colors } = useTheme();
  const detailHeader = {
    headerShown: true,
    ...nativeStackHeaderLeftIconOnly(colors.primary),
    headerBackVisible: false,
    headerTintColor: colors.primary,
    headerStyle: { backgroundColor: colors.background },
    // #1632: the app TopBar (KC logo) stays on every world screen.
    header: topBarStackHeader,
  } as const;
  const screenOptions = {
    headerShown: false,
    contentStyle: {
      backgroundColor: colors.background,
      flex: 1,
      width: '100%',
      minWidth: '100%',
      alignSelf: 'stretch',
    },
    ...nestedStackGestureOptions,
  } as const;
  return { detailHeader, screenOptions };
}

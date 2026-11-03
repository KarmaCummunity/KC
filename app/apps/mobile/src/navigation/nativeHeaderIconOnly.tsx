// iOS native stack draws a shared "glass" chip behind custom header views.
// Use unstable_* bar items with hidesSharedBackground so only the icon shows.
// See: UIBarButtonItem.hidesSharedBackground (react-native-screens / native-stack).
import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable } from 'react-native';
import type { ReactElement } from 'react';
import { useTheme, iconSize, spacing } from '@kc/ui';

function AndroidOverflowIcon({ options }: { options: { a11yLabel: string; onPress: () => void; iconColor?: string } }) {
  const { colors } = useTheme();
  const iconColor = options.iconColor ?? colors.textPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={options.a11yLabel}
      onPress={options.onPress}
      hitSlop={8}
      android_ripple={null}
      style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, padding: spacing.xs }]}
    >
      <Ionicons name="ellipsis-vertical" size={iconSize.xl} color={iconColor} />
    </Pressable>
  );
}
import { BackButton } from '../components/BackButton';

type CustomBarItem = {
  type: 'custom';
  element: ReactElement;
  hidesSharedBackground?: boolean;
};

/** Native UIBarButtonItem (plain) — avoids the glass pill around custom React views on iOS < 26. */
type IosNativeOverflowButtonItem = {
  type: 'button';
  label: string;
  icon: { type: 'sfSymbol'; name: 'ellipsis.circle' };
  onPress: () => void;
  variant: 'plain';
  hidesSharedBackground?: boolean;
};

type IosHeaderRightItem = CustomBarItem | IosNativeOverflowButtonItem;

/** Compatible with expo-router Stack (native-stack) screen options. */
export type NativeHeaderLeftFragment = {
  headerLeft?: (props: { tintColor?: string }) => ReactElement | null;
  unstable_headerLeftItems?: () => CustomBarItem[];
};

/** Header bar items must not call React context hooks — pass resolved tint from the screen. */
export function nativeStackHeaderLeftIconOnly(tintColor: string): NativeHeaderLeftFragment {
  return Platform.OS === 'ios'
    ? {
        // iOS uses unstable bar items — omit headerLeft so BackButton is not
        // mounted twice (avoids Rules-of-Hooks drift in SceneView).
        headerLeft: () => null,
        unstable_headerLeftItems: () => [
          {
            type: 'custom' as const,
            element: <BackButton tintColor={tintColor} />,
            hidesSharedBackground: true,
          },
        ],
      }
    : {
        headerLeft: ({ tintColor: navTint }) => (
          <BackButton tintColor={navTint ?? tintColor} />
        ),
      };
}

export type NativeHeaderRightFragment = {
  headerRight?: (props: { tintColor?: string }) => ReactElement | null;
  unstable_headerRightItems?: () => IosHeaderRightItem[];
};

export function nativeStackHeaderRightIconOnly(
  render: () => ReactElement
): NativeHeaderRightFragment {
  if (Platform.OS === 'ios') {
    return {
      headerRight: undefined,
      unstable_headerRightItems: () => [
        {
          type: 'custom' as const,
          element: render(),
          hidesSharedBackground: true,
        },
      ],
    };
  }
  return { headerRight: () => render() };
}

/** Chat / overflow "more" — iOS uses a plain SF Symbol bar button (no JS view bubble); Android disables ripple. */
export function nativeStackHeaderOverflowMenu(options: {
  a11yLabel: string;
  onPress: () => void;
  iconColor?: string;
}): NativeHeaderRightFragment {
  if (Platform.OS === 'ios') {
    return {
      headerRight: undefined,
      unstable_headerRightItems: () => [
        {
          type: 'button',
          label: options.a11yLabel,
          icon: { type: 'sfSymbol', name: 'ellipsis.circle' },
          onPress: options.onPress,
          variant: 'plain',
          hidesSharedBackground: true,
        },
      ],
    };
  }
  return { headerRight: () => <AndroidOverflowIcon options={options} /> };
}

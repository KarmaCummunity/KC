// Single-line native-stack header title (KC#1388): a long or translated title
// must never wrap, since a two-line title grows the iOS header over the content.
import React from 'react';
import type { TextStyle } from 'react-native';
import { Text, typography, useTheme } from '@kc/ui';

interface NativeStackHeaderTitleProps {
  readonly title: string;
  readonly style?: TextStyle;
}

export function NativeStackHeaderTitle({ title, style }: NativeStackHeaderTitleProps) {
  const { colors } = useTheme();
  return (
    <Text
      numberOfLines={1}
      ellipsizeMode="tail"
      accessibilityRole="header"
      style={[typography.h4, { color: colors.textPrimary }, style]}
    >
      {title}
    </Text>
  );
}

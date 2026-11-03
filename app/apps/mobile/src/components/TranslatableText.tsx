// FR-TRANSLATE-003 — renders one translatable field with source-then-swap UX.
import React from 'react';
import { View, type StyleProp, type TextStyle } from 'react-native';
import { Text } from '@kc/ui';
import { useTranslation } from 'react-i18next';

export type TranslatableStatus = 'hit' | 'translating' | 'source';

interface Props {
  source: string;
  translated?: string;
  status: TranslatableStatus;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
  indicatorStyle?: StyleProp<TextStyle>;
}

export function TranslatableText({ source, translated, status, numberOfLines, style, indicatorStyle }: Props) {
  const { t } = useTranslation();
  const isHit = status === 'hit' && !!translated;
  const shown = isHit ? (translated as string) : source;
  return (
    <View>
      <Text
        style={style}
        numberOfLines={numberOfLines}
        accessibilityLabel={isHit ? `${shown}. ${t('post.autoTranslated')}` : undefined}
      >
        {shown}
      </Text>
      {status === 'translating' ? (
        <Text style={indicatorStyle} accessibilityElementsHidden importantForAccessibility="no">
          {t('post.translating')}
        </Text>
      ) : null}
    </View>
  );
}

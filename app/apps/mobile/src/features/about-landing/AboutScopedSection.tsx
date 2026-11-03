import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { makeUseStyles, typography, spacing, Text } from '@kc/ui';
import { aboutRtlText, aboutRtlRow } from './aboutWebRtlStyle';
import { MOTION } from '../../lib/animations/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { AboutScopeToggle } from './AboutScopeToggle';
import { useAboutContentScope } from './AboutContentScopeContext';

interface ScopedItem {
  readonly title: string;
  readonly body: string;
}

export interface AboutScopedSectionProps {
  readonly titleI18nKey: string;
  readonly sectionA11yName: string;
  readonly itemsMvpI18nKey: string;
  readonly itemsVisionI18nKey: string;
}

export function AboutScopedSection({
  titleI18nKey,
  sectionA11yName,
  itemsMvpI18nKey,
  itemsVisionI18nKey,
}: AboutScopedSectionProps) {
  const { t } = useTranslation();
  const styles = useAboutScopedSectionStyles();
  const { scope } = useAboutContentScope();
  const reduced = useReducedMotion();
  const itemsKey = scope === 'mvp' ? itemsMvpI18nKey : itemsVisionI18nKey;
  const items = t(itemsKey, { returnObjects: true }) as ScopedItem[];
  const anim = reduced ? undefined : FadeIn.duration(MOTION.duration.base);

  return (
    <View>
      <Text style={styles.h}>{t(titleI18nKey)}</Text>
      <AboutScopeToggle sectionA11yName={sectionA11yName} />
      {anim ? (
        <Animated.View key={itemsKey} entering={anim} exiting={FadeOut.duration(MOTION.duration.fast)}>
          <NumberedList items={items} reduced={reduced} />
        </Animated.View>
      ) : (
        <NumberedList items={items} reduced={reduced} />
      )}
    </View>
  );
}

function NumberedList({ items, reduced }: Readonly<{ items: ScopedItem[]; reduced: boolean }>) {
  const styles = useAboutScopedSectionStyles();
  return (
    <View style={styles.list}>
      {items.map((it, i) => {
        const body = (
          <>
            <View style={styles.badge}>
              <Text style={styles.badgeNum}>{i + 1}</Text>
            </View>
            <View style={styles.copy}>
              <Text style={styles.title}>{it.title}</Text>
              <Text style={styles.body}>{it.body}</Text>
            </View>
          </>
        );
        const key = `${it.title}-${i}`;
        if (reduced) {
          return (
            <View key={key} style={styles.row}>
              {body}
            </View>
          );
        }
        return (
          <Animated.View
            key={key}
            style={styles.row}
            entering={FadeIn.duration(MOTION.duration.base).delay(32 + i * 55)}
          >
            {body}
          </Animated.View>
        );
      })}
    </View>
  );
}

const BADGE = 28;
const useAboutScopedSectionStyles = makeUseStyles(({ colors }) => ({
  h: { ...typography.h4, color: colors.textPrimary, ...aboutRtlText, marginBottom: spacing.xs },
  list: { gap: spacing.md },
  row: { flexDirection: aboutRtlRow, alignItems: 'flex-start', gap: spacing.md },
  badge: {
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    backgroundColor: colors.secondaryLight,
    borderWidth: 1,
    borderColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeNum: { ...typography.caption, color: colors.secondary, ...typography.extraBold },
  copy: { flex: 1, gap: spacing.xs },
  title: { ...typography.body, color: colors.textPrimary, ...aboutRtlText, ...typography.bold },
  body: { ...typography.body, color: colors.textSecondary, ...aboutRtlText, lineHeight: 22 },
}));

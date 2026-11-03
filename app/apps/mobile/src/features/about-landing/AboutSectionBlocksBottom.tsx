import React from 'react';
import { View, LayoutChangeEvent } from 'react-native';
import { makeUseStyles, shadow, typography, spacing, radius, Text } from '@kc/ui';
import { aboutRtlText } from './aboutWebRtlStyle';
import { useTranslation } from 'react-i18next';
import { AnimatedEntry } from '../../components/animations/AnimatedEntry';
import { MOTION } from '../../lib/animations/motion';
import type { AboutSectionId } from './aboutSectionModel';
import { AboutSocialLinks } from './AboutSocialLinks';
import { AboutRoadmapTimeline } from './AboutRoadmapTimeline';
import { AboutContributionsGrid } from './AboutContributionsGrid';
import { AboutFaqAccordion } from './AboutFaqAccordion';
import { AboutScopedSection } from './AboutScopedSection';
import { AboutContactLinks } from './AboutContactLinks';

function track(
  id: AboutSectionId,
  onY: (section: AboutSectionId, y: number) => void,
): (e: LayoutChangeEvent) => void {
  return (e) => onY(id, e.nativeEvent.layout.y);
}

export interface AboutSectionBlocksBottomProps {
  readonly onSectionY: (section: AboutSectionId, y: number) => void;
  readonly delayStart: number;
}

export function AboutSectionBlocksBottom({ onSectionY, delayStart }: AboutSectionBlocksBottomProps) {
  const { t } = useTranslation();
  const styles = useAboutSectionBlocksBottomStyles();
  let d = delayStart;
  const next = () => {
    const cur = d;
    d += 40;
    return cur;
  };

  return (
    <>
      <View onLayout={track('roadmap', onSectionY)} collapsable={false}>
        <AnimatedEntry
          delay={next()}
          duration={MOTION.duration.slow}
          distance={12}
          scaleEntrance={0.985}
        >
          <View style={styles.card}>
            <Text style={styles.h}>{t('aboutContent.roadmapTitle')}</Text>
            <Text style={styles.lead}>{t('aboutContent.roadmapLead')}</Text>
            <View style={styles.spacer} />
            <AboutRoadmapTimeline />
          </View>
        </AnimatedEntry>
      </View>

      <View onLayout={track('goals', onSectionY)} collapsable={false}>
        <AnimatedEntry
          delay={next()}
          duration={MOTION.duration.slow}
          distance={12}
          scaleEntrance={0.985}
        >
          <View style={styles.card}>
            <AboutScopedSection
              titleI18nKey="aboutContent.goalsTitle"
              sectionA11yName={t('aboutContent.navGoals')}
              itemsMvpI18nKey="aboutContent.goalsItemsMvp"
              itemsVisionI18nKey="aboutContent.goalsItemsVision"
            />
          </View>
        </AnimatedEntry>
      </View>

      <View onLayout={track('contributions', onSectionY)} collapsable={false}>
        <AnimatedEntry
          delay={next()}
          duration={MOTION.duration.slow}
          distance={12}
          scaleEntrance={0.985}
        >
          <View style={styles.card}>
            <Text style={styles.h}>{t('aboutContent.contributionsTitle')}</Text>
            <Text style={styles.p}>{t('aboutContent.contributionsText')}</Text>
            <View style={styles.spacer} />
            <AboutContributionsGrid />
          </View>
        </AnimatedEntry>
      </View>

      <View onLayout={track('social', onSectionY)} collapsable={false}>
        <AnimatedEntry
          delay={next()}
          duration={MOTION.duration.slow}
          distance={12}
          scaleEntrance={0.985}
        >
          <View style={styles.card}>
            <AboutSocialLinks />
          </View>
        </AnimatedEntry>
      </View>

      <View onLayout={track('faq', onSectionY)} collapsable={false}>
        <AnimatedEntry
          delay={next()}
          duration={MOTION.duration.slow}
          distance={12}
          scaleEntrance={0.985}
        >
          <View style={styles.card}>
            <Text style={styles.h}>{t('aboutContent.navFaq')}</Text>
            <View style={styles.spacer} />
            <AboutFaqAccordion />
          </View>
        </AnimatedEntry>
      </View>

      <View onLayout={track('contact', onSectionY)} collapsable={false}>
        <AnimatedEntry
          delay={next()}
          duration={MOTION.duration.slow}
          distance={12}
          scaleEntrance={0.985}
        >
          <View style={styles.card}>
            <Text style={styles.h}>{t('aboutContent.contactTitle')}</Text>
            <View style={styles.spacer} />
            <AboutContactLinks />
          </View>
        </AnimatedEntry>
      </View>
    </>
  );
}

const useAboutSectionBlocksBottomStyles = makeUseStyles(({ colors }) => ({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  h: { ...typography.h4, color: colors.textPrimary, ...aboutRtlText, marginBottom: spacing.xs },
  lead: {
    ...typography.body,
    color: colors.textSecondary,
    ...aboutRtlText,
    lineHeight: 24,
    marginBottom: spacing.sm,
  },
  p: { ...typography.body, color: colors.textSecondary, ...aboutRtlText, lineHeight: 24 },
  spacer: { height: spacing.sm },
}));

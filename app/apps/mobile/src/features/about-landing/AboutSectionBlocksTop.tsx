import React from 'react';
import { View, LayoutChangeEvent } from 'react-native';
import { makeUseStyles, typography, spacing, radius, shadow, Text } from '@kc/ui';
import { aboutRtlText } from './aboutWebRtlStyle';
import { useTranslation } from 'react-i18next';
import { AnimatedEntry } from '../../components/animations/AnimatedEntry';
import { MOTION } from '../../lib/animations/motion';
import type { AboutSectionId } from './aboutSectionModel';
import { AboutLiveNumbers } from './AboutLiveNumbers';
import { OrgTransparencySection } from '../../components/finance/OrgTransparencySection';
import { AboutValuesGrid } from './AboutValuesGrid';
import { AboutVisionSection } from './AboutVisionSection';
import { AboutScopedSection } from './AboutScopedSection';
import { AboutMissionTeamSection } from './AboutMissionTeamSection';
import { AboutGovernanceSection } from './AboutGovernanceSection';
import { AboutLogoEvolutionSection } from './AboutLogoEvolutionSection';
import { AboutAudienceSection } from './AboutAudienceSection';
import { DonationSupportCard } from '../../components/DonationSupportCard';

function SectionCard({
  children,
  style,
}: Readonly<{ children: React.ReactNode; style?: object }>) {
  const styles = useAboutSectionBlocksTopStyles();
  return <View style={[styles.card, style]}>{children}</View>;
}

function track(
  id: AboutSectionId,
  onY: (section: AboutSectionId, y: number) => void,
): (e: LayoutChangeEvent) => void {
  return (e) => onY(id, e.nativeEvent.layout.y);
}

function trackMissionTeam(onY: (section: AboutSectionId, y: number) => void): (e: LayoutChangeEvent) => void {
  return (e) => {
    const y = e.nativeEvent.layout.y;
    onY('mission', y);
    onY('team', y);
  };
}

export interface AboutSectionBlocksTopProps {
  readonly onSectionY: (section: AboutSectionId, y: number) => void;
}

export function AboutSectionBlocksTop({ onSectionY }: AboutSectionBlocksTopProps) {
  const { t } = useTranslation();
  const styles = useAboutSectionBlocksTopStyles();
  let d = 0;
  const next = () => {
    const cur = d;
    d += 40;
    return cur;
  };

  return (
    <>
      <View onLayout={track('numbers', onSectionY)} collapsable={false}>
        <AnimatedEntry
          delay={next()}
          duration={MOTION.duration.slow}
          distance={12}
          scaleEntrance={0.985}
        >
          <SectionCard>
            <Text style={styles.h}>{t('aboutContent.numbersTitle')}</Text>
            <Text style={styles.lead}>{t('aboutContent.numbersLead')}</Text>
            <Text style={styles.p}>{t('aboutContent.numbersBody')}</Text>
            <View style={styles.liveStatsWrap}>
              <AboutLiveNumbers />
            </View>
            <OrgTransparencySection style={styles.liveStatsWrap} />
          </SectionCard>
        </AnimatedEntry>
      </View>
      <View onLayout={track('vision', onSectionY)} collapsable={false}>
        <AnimatedEntry
          delay={next()}
          duration={MOTION.duration.slow}
          distance={12}
          scaleEntrance={0.985}
        >
          <SectionCard>
            <AboutVisionSection />
          </SectionCard>
        </AnimatedEntry>
      </View>
      <View onLayout={track('logo', onSectionY)} collapsable={false}>
        <AnimatedEntry
          delay={next()}
          duration={MOTION.duration.slow}
          distance={12}
          scaleEntrance={0.985}
        >
          <SectionCard>
            <AboutLogoEvolutionSection />
          </SectionCard>
        </AnimatedEntry>
      </View>
      <AnimatedEntry
        delay={next()}
        duration={MOTION.duration.slow}
        distance={12}
        scaleEntrance={0.985}
      >
        <DonationSupportCard />
      </AnimatedEntry>
      <View onLayout={track('problems', onSectionY)} collapsable={false}>
        <AnimatedEntry
          delay={next()}
          duration={MOTION.duration.slow}
          distance={12}
          scaleEntrance={0.985}
        >
          <SectionCard>
            <AboutScopedSection
              titleI18nKey="aboutContent.problemsTitle"
              sectionA11yName={t('aboutContent.navProblems')}
              itemsMvpI18nKey="aboutContent.problemsItemsMvp"
              itemsVisionI18nKey="aboutContent.problemsItemsVision"
            />
          </SectionCard>
        </AnimatedEntry>
      </View>
      <View onLayout={track('features', onSectionY)} collapsable={false}>
        <AnimatedEntry
          delay={next()}
          duration={MOTION.duration.slow}
          distance={12}
          scaleEntrance={0.985}
        >
          <SectionCard>
            <AboutScopedSection
              titleI18nKey="aboutContent.featuresTitle"
              sectionA11yName={t('aboutContent.navFeatures')}
              itemsMvpI18nKey="aboutContent.featuresBulletsMvp"
              itemsVisionI18nKey="aboutContent.featuresBulletsVision"
            />
          </SectionCard>
        </AnimatedEntry>
      </View>
      <View onLayout={track('how', onSectionY)} collapsable={false}>
        <AnimatedEntry
          delay={next()}
          duration={MOTION.duration.slow}
          distance={12}
          scaleEntrance={0.985}
        >
          <SectionCard>
            <Text style={styles.h}>{t('aboutContent.howItWorksTitle')}</Text>
            <Text style={styles.p}>{t('aboutContent.howItWorksText')}</Text>
          </SectionCard>
        </AnimatedEntry>
      </View>
      <View onLayout={track('audience', onSectionY)} collapsable={false}>
        <AnimatedEntry
          delay={next()}
          duration={MOTION.duration.slow}
          distance={12}
          scaleEntrance={0.985}
        >
          <AboutAudienceSection />
        </AnimatedEntry>
      </View>
      <View onLayout={trackMissionTeam(onSectionY)} collapsable={false}>
        <AnimatedEntry
          delay={next()}
          duration={MOTION.duration.slow}
          distance={12}
          scaleEntrance={0.985}
        >
          <SectionCard>
            <AboutMissionTeamSection />
          </SectionCard>
        </AnimatedEntry>
      </View>
      <View onLayout={track('values', onSectionY)} collapsable={false}>
        <AnimatedEntry
          delay={next()}
          duration={MOTION.duration.slow}
          distance={12}
          scaleEntrance={0.985}
        >
          <SectionCard>
            <Text style={styles.h}>{t('aboutContent.valuesTitle')}</Text>
            <Text style={styles.p}>{t('aboutContent.valuesText')}</Text>
            <View style={styles.valuesSpacer} />
            <AboutValuesGrid />
          </SectionCard>
        </AnimatedEntry>
      </View>
      <View onLayout={track('governance', onSectionY)} collapsable={false}>
        <AnimatedEntry
          delay={next()}
          duration={MOTION.duration.slow}
          distance={12}
          scaleEntrance={0.985}
        >
          <SectionCard>
            <AboutGovernanceSection />
          </SectionCard>
        </AnimatedEntry>
      </View>
    </>
  );
}

const useAboutSectionBlocksTopStyles = makeUseStyles(({ colors }) => ({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  h: { ...typography.h4, color: colors.textPrimary, ...aboutRtlText, marginBottom: spacing.sm },
  lead: { ...typography.body, ...typography.semiBold, color: colors.textPrimary, ...aboutRtlText, marginBottom: spacing.sm },
  p: { ...typography.body, color: colors.textSecondary, ...aboutRtlText, lineHeight: 24 },
  liveStatsWrap: { marginTop: spacing.lg },
  valuesSpacer: { height: spacing.sm },
}));

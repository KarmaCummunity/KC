// Onboarding step 2 — FR-AUTH-010
import React from 'react';
import { View, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { makeUseStyles, typography, spacing, radius, useTheme, Text } from '@kc/ui';
import { CityPicker } from '../../src/components/CityPicker';
import { StreetPicker } from '../../src/components/StreetPicker';
import { OnboardingStepHeader } from '../../src/components/OnboardingStepHeader';
import { useOnboardingBasicInfoFlow } from '../../src/hooks/useOnboardingBasicInfoFlow';
import { AnimatedEntry } from '../../src/components/animations/AnimatedEntry';
import { staggerDelay } from '../../src/lib/animations/motion';
import { rtlTextAlignStart } from '../../src/lib/rtlTextAlignStart';
import { TextField } from '../../src/components/ui/TextField';
import { PrimaryButton } from '../../src/components/ui/Buttons';

/** Side of the round halo behind the hero glyph, in points (a layout size). */
const HERO_HALO_SIZE = 68;

export default function OnboardingBasicInfoScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const {
    displayName, setDisplayName, city, setCity, street, setStreet, streetNumber, setStreetNumber,
    contactPhone, setContactPhone,
    loading, hasRequiredFields, handleBack, handleContinue, handleSkip,
  } = useOnboardingBasicInfoFlow();

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.fill}
      >
        <View style={styles.content}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <OnboardingStepHeader
              step={2}
              onSkip={handleSkip}
              onBack={handleBack}
              skipDisabled={loading}
              backDisabled={loading}
            />

            <AnimatedEntry delay={staggerDelay(0)} style={styles.iconWrap}>
              <View style={styles.iconHalo}>
                <Ionicons
                  name="person-outline"
                  size={32} // brand-guard-allow: hero glyph above the title, off the icon scale (spec 17 §4.2)
                  color={colors.primary}
                />
              </View>
            </AnimatedEntry>

            <AnimatedEntry delay={staggerDelay(1)}>
              <Text style={styles.title}>{t('onboarding.stepBasic')}</Text>
            </AnimatedEntry>

            <AnimatedEntry delay={staggerDelay(2)}>
              <Text style={styles.subtitle}>{t('onboarding.basicInfoSubtitle')}</Text>
            </AnimatedEntry>

            <AnimatedEntry delay={staggerDelay(3)}>
              <TextField
                containerStyle={styles.field}
                label={t('onboarding.displayName')}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder={t('onboarding.fullNamePlaceholder')}
                maxLength={50}
                editable={!loading}
              />
            </AnimatedEntry>

            <AnimatedEntry delay={staggerDelay(4)}>
              <View style={styles.field}>
                <Text style={styles.label}>{t('profile.addressLabel')}</Text>
                <CityPicker value={city} onChange={setCity} disabled={loading} />
              </View>
            </AnimatedEntry>

            {city ? (
              <AnimatedEntry delay={0}>
                <View style={styles.field}>
                  <View style={styles.streetRow}>
                    <View style={styles.streetCol}>
                      <StreetPicker
                        cityId={city.id}
                        value={street ? { id: '', name: street } : null}
                        onChange={(sel) => setStreet(sel.name)}
                        disabled={loading}
                      />
                    </View>
                    <TextField
                      containerStyle={styles.streetNumberCol}
                      style={styles.streetNumberInput}
                      label={t('profile.streetNumberShort')}
                      value={streetNumber}
                      onChangeText={setStreetNumber}
                      placeholder={t('profile.streetNumberShort')}
                      editable={!loading}
                      maxLength={10}
                    />
                  </View>
                </View>
              </AnimatedEntry>
            ) : null}

            <AnimatedEntry delay={staggerDelay(5)}>
              <TextField
                containerStyle={styles.field}
                label={t('onboarding.contactPhoneLabel')}
                value={contactPhone}
                onChangeText={setContactPhone}
                placeholder={t('onboarding.contactPhonePlaceholder')}
                maxLength={20}
                keyboardType="phone-pad"
                editable={!loading}
              />
            </AnimatedEntry>
          </ScrollView>

          <AnimatedEntry delay={staggerDelay(6)} style={styles.ctaWrap}>
            <PrimaryButton
              label={t('onboarding.continue')}
              accessibilityLabel={t('onboarding.continueA11y')}
              icon="arrow-back"
              fullWidth
              loading={loading}
              disabled={!hasRequiredFields}
              onPress={handleContinue}
            />
          </AnimatedEntry>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  fill: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.base,
    paddingBottom: spacing.base,
  },
  scroll: { flex: 1 },
  scrollContent: { gap: spacing.base, paddingBottom: spacing.lg },
  iconWrap: { alignItems: 'center', marginTop: spacing.sm, marginBottom: spacing.xs },
  iconHalo: {
    width: HERO_HALO_SIZE,
    height: HERO_HALO_SIZE,
    borderRadius: radius.full,
    backgroundColor: colors.primarySurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.h1,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.bodyLarge,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.base,
    paddingHorizontal: spacing.sm,
  },
  field: {
    width: '100%',
    maxWidth: 500,
    alignSelf: 'center',
    gap: spacing.xs,
  },
  label: { ...typography.label, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  // The number field carries its own label, so the row lines the two boxes up at the bottom.
  streetRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-end',
    width: '100%',
  },
  streetCol: { flex: 2, minWidth: 0 },
  streetNumberCol: { flex: 1, minWidth: 0, maxWidth: 120 },
  // Lets the narrow input shrink below the browser's default input width on web.
  streetNumberInput: { minWidth: 0 },
  ctaWrap: { marginTop: spacing.sm },
}));

// Onboarding step 2 — FR-AUTH-010
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { makeUseStyles, typography, spacing, radius, iconSize, useTheme, Text } from '@kc/ui';
import { CityPicker } from '../../src/components/CityPicker';
import { StreetPicker } from '../../src/components/StreetPicker';
import { OnboardingStepHeader } from '../../src/components/OnboardingStepHeader';
import { useOnboardingBasicInfoFlow } from '../../src/hooks/useOnboardingBasicInfoFlow';
import { AnimatedEntry } from '../../src/components/animations/AnimatedEntry';
import { staggerDelay } from '../../src/lib/animations/motion';
import { rtlTextAlignStart } from '../../src/lib/rtlTextAlignStart';
import { TextField, FormScreen, PrimaryButton } from '../../src/components/ui';
import { CompactStreetNumberField } from '../../src/components/address/CompactStreetNumberField';
import { formPhoneInputProps } from '../../src/lib/platform/formTextInputHints';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

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
    <FormScreen
      headerless
      edges={['top', 'bottom']}
      contentContainerStyle={styles.scrollContent}
      footer={
        <AnimatedEntry delay={staggerDelay(6)}>
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
      }
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
            size={iconSize['2xl']}
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
              <CompactStreetNumberField
                containerStyle={styles.streetNumberCol}
                style={styles.streetNumberInput}
                value={streetNumber}
                onChangeText={setStreetNumber}
                editable={!loading}
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
          editable={!loading}
          {...formPhoneInputProps}
        />
      </AnimatedEntry>
    </FormScreen>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  scrollContent: {
    gap: spacing.base,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.base,
  },
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
  streetRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-end',
    width: '100%',
  },
  streetCol: { flex: 2, minWidth: 0 },
  streetNumberCol: { flex: 1, minWidth: 0, maxWidth: 120 },
  streetNumberInput: { minWidth: 0 },
}));

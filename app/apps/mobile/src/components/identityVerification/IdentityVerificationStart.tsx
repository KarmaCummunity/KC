// FR-VERIFY-004 AC1 / AC2 — explainer, consent and the start button shown before the provider flow.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@kc/ui';
import { PrimaryButton } from '../ui/Buttons';
import { useCreatePostStyles } from '../../screens/tabs/create.styles';
import { useStartIdentityVerification } from '../../hooks/useIdentityVerification';
import { IdentityConsentCheckbox } from './IdentityConsentCheckbox';
import { identityStartErrorKey } from './identityStatusText';

/** Explainer lines, in reading order (FR-VERIFY-004 AC1). */
const EXPLAINER_LINES = ['why', 'what', 'who', 'keeps', 'retention', 'withdraw'] as const;

interface IdentityVerificationStartProps {
  /** Button label: "start" the first time, "try again" after a decline or resubmit. */
  readonly labelKey: 'verification.identity.start' | 'verification.identity.retry';
}

export function IdentityVerificationStart({ labelKey }: IdentityVerificationStartProps) {
  const { t } = useTranslation();
  const styles = useCreatePostStyles();
  // Never pre-ticked: consent is an explicit act each time the explainer is shown.
  const [consentGiven, setConsentGiven] = useState(false);
  const { start, isStarting, errorCode } = useStartIdentityVerification();

  return (
    <View style={styles.section} testID="identity-start">
      <Text style={styles.sectionLabel}>{t('verification.identity.explainer.title')}</Text>
      {EXPLAINER_LINES.map((line) => (
        <Text key={line} style={styles.sectionHint}>
          {t(`verification.identity.explainer.${line}`)}
        </Text>
      ))}
      <IdentityConsentCheckbox
        checked={consentGiven}
        label={t('verification.identity.consent')}
        onToggle={setConsentGiven}
      />
      {errorCode ? (
        <Text style={styles.sectionHint} testID="identity-start-error" accessibilityRole="alert">
          {t(identityStartErrorKey(errorCode))}
        </Text>
      ) : null}
      <PrimaryButton
        testID="identity-start-button"
        label={t(labelKey)}
        disabled={!consentGiven || isStarting}
        loading={isStarting}
        onPress={() => start(consentGiven)}
      />
    </View>
  );
}

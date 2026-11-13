// What a screen of a parked feature (src/lib/parkedFeatures.ts) shows when it is reached by a
// direct link: the shared "not available yet" state of the degrade rule, never a failed call.
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles } from '@kc/ui';
import { EmptyState } from './EmptyState';

export function ParkedFeatureNotice({ testID }: { readonly testID?: string }) {
  const { t } = useTranslation();
  const styles = useStyles();
  return (
    <View style={styles.root} testID={testID}>
      <EmptyState icon="construct-outline" title={t('backend.notAvailableTitle')} subtitle={t('backend.notAvailableYet')} />
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root: { flex: 1, backgroundColor: colors.background, justifyContent: 'center' as const },
}));

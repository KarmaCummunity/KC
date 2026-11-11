import React, { type ReactNode } from 'react';
import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@kc/ui';
import { useCreatePostStyles } from '../../screens/tabs/create.styles';

interface KindGateProps {
  readonly loading: boolean;
  readonly missing: boolean;
  readonly onRetry: () => void;
  readonly children: ReactNode;
}

/** Spinner while the world's kinds load; a retry message when none can be used. */
export function KindGate({ loading, missing, onRetry, children }: KindGateProps) {
  const { t } = useTranslation();
  const styles = useCreatePostStyles();
  if (loading) return <ActivityIndicator testID="listing-kinds-loading" />;
  if (!missing) return <>{children}</>;
  return (
    <View style={styles.section} testID="listing-kinds-error">
      <Text style={styles.sectionHint}>{t('post.unifiedCreate.errors.loadFailed')}</Text>
      <TouchableOpacity onPress={onRetry} accessibilityRole="button">
        <Text style={styles.sectionLabel}>{t('general.retry')}</Text>
      </TouchableOpacity>
    </View>
  );
}

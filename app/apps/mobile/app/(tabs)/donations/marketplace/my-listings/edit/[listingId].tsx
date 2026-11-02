import React, { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { makeUseStyles, spacing, Text } from '@kc/ui';
import { Screen } from '../../../../../../src/components/ui/Screen';
import { TextField } from '../../../../../../src/components/ui/TextField';
import { PrimaryButton } from '../../../../../../src/components/ui/Buttons';
import { marketplaceRepository } from '../../../../../../src/services/marketplaceComposition';
import { useInvalidateMyListings } from '../../../../../../src/hooks/useMyMarketplaceListings';

const useStyles = makeUseStyles(() => ({
  body: { padding: spacing.lg, gap: spacing.md },
  loading: { marginTop: spacing['4xl'] },
  message: { padding: spacing.lg },
}));

export default function EditMyListingScreen() {
  const { listingId } = useLocalSearchParams<{ listingId: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const invalidate = useInvalidateMyListings();
  const [saving, setSaving] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['marketplace', 'detail', listingId],
    queryFn: () => marketplaceRepository().getListingDetail(listingId!),
    enabled: Boolean(listingId),
  });

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  React.useEffect(() => {
    if (!detailQuery.data) return;
    setTitle(detailQuery.data.title);
    setSummary(detailQuery.data.summary ?? '');
  }, [detailQuery.data?.listingId]);

  const save = async () => {
    setSaving(true);
    try {
      await marketplaceRepository().updateMyListing(listingId!, {
        title: title.trim(),
        summary: summary.trim() || null,
      });
      await invalidate();
      router.back();
    } finally {
      setSaving(false);
    }
  };

  if (detailQuery.isLoading) {
    return (
      <Screen>
        <ActivityIndicator style={styles.loading} />
      </Screen>
    );
  }

  if (!detailQuery.data) {
    return (
      <Screen>
        <Text style={styles.message}>{t('marketplace.notFound')}</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.body}>
        <TextField label={t('marketplace.fieldTitle')} value={title} onChangeText={setTitle} />
        <TextField label={t('marketplace.fieldSummary')} value={summary} onChangeText={setSummary} multiline />
        {/* The label switches to "saving…" while the update runs, as before the kit button. */}
        <PrimaryButton
          testID="edit-listing-save"
          label={saving ? t('marketplace.publishing') : t('marketplace.myListingsSave')}
          fullWidth
          disabled={saving || title.trim().length < 2}
          onPress={() => void save()}
        />
      </View>
    </Screen>
  );
}

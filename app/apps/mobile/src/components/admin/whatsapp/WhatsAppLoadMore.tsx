// "Load more" for a keyset-paged console list; hidden on the last page.
import { Pressable } from 'react-native';
import { Text } from '@kc/ui';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { useWhatsAppAdminStyles } from './whatsappAdminStyles';

export function WhatsAppLoadMore({ hasMore, onPress, testID }: {
  readonly hasMore: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  const styles = useWhatsAppAdminStyles();
  const t = useLocaleBundle().admin.whatsapp;
  if (!hasMore) return null;
  return (
    <Pressable testID={testID} accessibilityRole="button" style={styles.linkBtn} onPress={onPress}>
      <Text style={styles.link}>{t.loadMore}</Text>
    </Pressable>
  );
}

// New conversation picker — FR-CHAT-017. People I follow first, name search across members below.
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { ListRenderItem } from 'react-native';
import type { User } from '@kc/domain';
import { makeUseStyles, spacing, typography, Text, useTheme } from '@kc/ui';
import { FilterSearchBar } from '../../src/components/filterKit/FilterSearchBar';
import { EmptyState } from '../../src/components/EmptyState';
import { PrimaryButton } from '../../src/components/ui/Buttons';
import { NotifyModal } from '../../src/components/NotifyModal';
import { KcFlashList } from '../../src/components/lists/KcFlashList';
import { ChatRecipientRow } from '../../src/components/chat/ChatRecipientRow';
import { NativeStackHeaderTitle } from '../../src/navigation/NativeStackHeaderTitle';
import { useDetailStackScreenOptions } from '../../src/navigation/detailStackScreenOptions';
import { useChatStartCandidates } from '../../src/hooks/useChatStartCandidates';
import { useAuthStore } from '../../src/store/authStore';
import { container } from '../../src/lib/container';
import { rtlTextAlignStart } from '../../src/lib/rtlTextAlignStart';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

type Row =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'user'; key: string; user: User };

const keyOf = (r: Row) => r.key;

export default function NewChatScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  const detailOptions = useDetailStackScreenOptions();
  const me = useAuthStore((s) => s.session?.userId);
  const [q, setQ] = useState('');
  const [opening, setOpening] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { query, pending } = useChatStartCandidates(me, q);
  const data = query.data;
  const searching = q.trim().length >= 2;

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const out: Row[] = [];
    if (data.following.length > 0) {
      out.push({ kind: 'header', key: 'h-following', label: t('chat.new.followingSection') });
      data.following.forEach((user) => out.push({ kind: 'user', key: `f-${user.userId}`, user }));
    }
    if (data.others.length > 0) {
      out.push({ kind: 'header', key: 'h-others', label: t('chat.new.othersSection') });
      data.others.forEach((user) => out.push({ kind: 'user', key: `o-${user.userId}`, user }));
    }
    return out;
  }, [data, t]);

  // FR-CHAT-017 AC5: same open-or-create as the profile CTA; an existing thread of the pair is reused.
  const onPick = useCallback(
    async (user: User) => {
      if (!me || opening) return;
      setOpening(true);
      try {
        const chat = await container.openOrCreateChat.execute({ viewerId: me, otherUserId: user.userId });
        router.replace({ pathname: '/chat/[id]', params: { id: chat.chatId } });
      } catch {
        setErrorMsg(t('chat.new.openError'));
        setOpening(false);
      }
    },
    [me, opening, router, t],
  );

  const renderItem = useCallback<ListRenderItem<Row>>(
    ({ item }) =>
      item.kind === 'header' ? (
        <Text style={styles.sectionTitle}>{item.label}</Text>
      ) : (
        <ChatRecipientRow user={item.user} disabled={opening} onPick={onPick} />
      ),
    [onPick, opening, styles.sectionTitle],
  );

  return (
    <View style={styles.container} testID="chat-new-screen">
      <Stack.Screen
        options={{
          ...detailOptions,
          headerTitle: () => <NativeStackHeaderTitle title={t('chat.new.title')} />,
        }}
      />
      <FilterSearchBar
        style={styles.searchWrap}
        value={q}
        onChangeText={setQ}
        placeholder={t('chat.new.searchPlaceholder')}
        testID="chat-new-search"
      />
      {query.isLoading ? (
        <ActivityIndicator style={styles.loader} color={colors.primary} />
      ) : (
        <KcFlashList
          estimatedItemSize={64}
          data={rows}
          keyExtractor={keyOf}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            query.isError ? (
              <EmptyState
                icon="cloud-offline-outline"
                title={t('general.errorTitle')}
                subtitle={t('errorBoundary.body')}
                action={
                  <PrimaryButton
                    testID="chat-new-retry"
                    label={t('general.retry')}
                    size="md"
                    onPress={() => void query.refetch()}
                  />
                }
              />
            ) : pending ? null : searching ? (
              <EmptyState icon="search-outline" title={t('chat.new.noResults')} />
            ) : (
              <EmptyState
                icon="people-outline"
                title={t('chat.new.emptyTitle')}
                subtitle={t('chat.new.emptyBody')}
              />
            )
          }
        />
      )}
      <NotifyModal
        visible={errorMsg !== null}
        title={t('chat.errorTitle')}
        message={errorMsg ?? ''}
        onDismiss={() => setErrorMsg(null)}
      />
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  searchWrap: { padding: spacing.sm, backgroundColor: colors.surface, marginBottom: 0 },
  loader: { marginTop: spacing.xl },
  sectionTitle: {
    ...typography.caption,
    ...typography.semiBold,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    paddingHorizontal: spacing.base,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
}));

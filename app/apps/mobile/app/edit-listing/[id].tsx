// FR-POST-001 AC3 — edit a listing-world post (rides, food, housing, time) with the same
// category fields as create, including ride meeting points (FR-RIDE-030).
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { iconSize, spacing, Text, useTheme } from '@kc/ui';
import { isFeedWorldSlug } from '@kc/domain';
import { Screen } from '../../src/components/ui/Screen';
import { useAuthStore } from '../../src/store/authStore';
import { getPostByIdUseCase } from '../../src/services/postsComposition';
import { useCreatePostStyles } from '../../src/screens/tabs/create.styles';
import { ListingCreateForm } from '../../src/components/CreatePostForm/ListingCreateForm';
import { CreateFormHeaderPublishAction } from '../../src/components/CreatePostForm/CreateFormHeaderPublishAction';
import { useKeyboardVerticalOffset } from '../../src/lib/platform/useKeyboardVerticalOffset';
import { TAB_INLINE_FORM_HEADER_HEIGHT } from '../../src/lib/platform/formChromeHeights';
import { EmptyState } from '../../src/components/EmptyState';
import type { CreateDirection } from '../../src/lib/unifiedCreate/createCategories';
import { resolveKeyboardAvoidingBehavior } from '../../src/lib/platform/keyboardVerticalOffset';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

export default function EditListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useCreatePostStyles();
  const queryClient = useQueryClient();
  const viewerId = useAuthStore((s) => s.session?.userId ?? null);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [publishAction, setPublishAction] = useState<(() => void) | null>(null);
  const [publishLoading, setPublishLoading] = useState(false);
  const setPublishState = useCallback((action: (() => void) | null, loading: boolean) => {
    setPublishAction(() => action);
    setPublishLoading(loading);
  }, []);
  const keyboardOffset = useKeyboardVerticalOffset({
    headerHeight: TAB_INLINE_FORM_HEADER_HEIGHT,
    contentBelowTopSafeArea: true,
  });

  const postQuery = useQuery({
    queryKey: ['post', id, viewerId],
    queryFn: () => getPostByIdUseCase().execute({ postId: id ?? '', viewerId }),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
  const post = postQuery.data?.post;
  const world = post?.listingWorldSlug;
  const listingId = post?.listingId;
  const direction: CreateDirection = post?.type === 'Request' ? 'request' : 'give';

  const postId = post?.postId;
  const postTitle = post?.title;
  const postDescription = post?.description;
  useEffect(() => {
    if (!postId || postTitle === undefined) return;
    setTitle(postTitle);
    setSummary(postDescription ?? '');
  }, [postId, postTitle, postDescription]);

  const onSaved = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['post', id] });
    void queryClient.invalidateQueries({ queryKey: ['feed'] });
    if (listingId) {
      void queryClient.invalidateQueries({ queryKey: ['marketplace', 'detail', listingId] });
    }
    router.back();
  }, [queryClient, id, listingId, router]);

  if (postQuery.isLoading) {
    return (
      <Screen>
        <ActivityIndicator style={{ marginTop: spacing['3xl'] }} />
      </Screen>
    );
  }

  if (!post || !listingId || !world || !isFeedWorldSlug(world) || world === 'items') {
    return (
      <Screen>
        <EmptyState icon="search-outline" title={t('post.editPost.notFoundTitle')} subtitle={t('post.editPost.notFoundSubtitle')} />
      </Screen>
    );
  }

  if (viewerId !== post.ownerId) {
    return (
      <Screen>
        <EmptyState icon="lock-closed-outline" title={t('post.editPost.forbiddenTitle')} subtitle={t('post.editPost.forbiddenSubtitle')} />
      </Screen>
    );
  }

  if (post.status !== 'open') {
    return (
      <Screen>
        <EmptyState icon="archive-outline" title={t('post.editPost.notEditableTitle')} subtitle={t('post.editPost.notEditableRemoved')} />
      </Screen>
    );
  }

  const categoryLabel = t(`post.unifiedCreate.categories.${world}`);

  return (
    <Screen blobs="off" testID="edit-listing-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerClose} accessibilityRole="button">
          <Ionicons name="close" size={iconSize['2xl']} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('post.editListing.headerTitle', { category: categoryLabel })}</Text>
        <CreateFormHeaderPublishAction
          onPress={() => publishAction?.()}
          loading={publishLoading}
          disabled={publishAction === null}
        />
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={resolveKeyboardAvoidingBehavior(Platform.OS)}
        keyboardVerticalOffset={keyboardOffset}
      >
        <ListingCreateForm
          worldSlug={world}
          direction={direction}
          title={title}
          onTitleChange={setTitle}
          summary={summary}
          onSummaryChange={setSummary}
          onPublished={() => {}}
          onPublishActionChange={setPublishState}
          editListingId={listingId}
          onSaved={onSaved}
          header={
            <View style={{ paddingHorizontal: spacing.base, paddingBottom: spacing.sm }}>
              <Text style={styles.headerTitle}>{categoryLabel}</Text>
              <Text style={{ opacity: 0.7 }}>
                {direction === 'give' ? t('post.unifiedCreate.offer') : t('post.unifiedCreate.request')}
              </Text>
            </View>
          }
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

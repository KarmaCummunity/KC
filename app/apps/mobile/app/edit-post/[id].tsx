// FR-POST-008, FR-POST-009, FR-POST-015 AC1, FR-ADMIN-006. Edit form for open posts (owner or super-admin).
// FR-POST-005 — images: same picker + upload pipeline as create.
// Closes TD-130. Field state lives in useEditPostForm and the save in useEditPostSave (#1752).
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { iconSize, useTheme, Text } from '@kc/ui';
import { isPostEditableByOwner, postOwnerActions } from '@kc/domain';
import { useAuthStore } from '../../src/store/authStore';
import { useIsSuperAdmin } from '../../src/hooks/useIsSuperAdmin';
import { getListPostActorIdentityUseCase, getPostByIdUseCase } from '../../src/services/postsComposition';
import { ExpiredRepublishView } from '../../src/components/post/ExpiredRepublishView';
import { usePostImageUploads, type PostImageUploadSummary } from '../../src/hooks/usePostImageUploads';
import { uploadErrorMessage } from '../../src/services/storageObjectUpload';
import { useEditPostForm } from '../../src/hooks/useEditPostForm';
import { useEditPostSave } from '../../src/hooks/useEditPostSave';
import { useEditPostValidation } from '../../src/hooks/useEditPostValidation';
import { EmptyState } from '../../src/components/EmptyState';
import { EditPostFormScrollContent } from '../../src/components/post/EditPostFormScrollContent';
import { NotifyModal } from '../../src/components/NotifyModal';
import { getUserRepo } from '../../src/services/userComposition';
import { useEditPostScreenStyles } from '../../src/screens/edit-post/editPostScreen.styles';
import { useKeyboardVerticalOffset } from '../../src/lib/platform/useKeyboardVerticalOffset';
import { TAB_INLINE_FORM_HEADER_HEIGHT } from '../../src/lib/platform/formChromeHeights';
import { resolveKeyboardAvoidingBehavior } from '../../src/lib/platform/keyboardVerticalOffset';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

export default function EditPostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const styles = useEditPostScreenStyles();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const viewerId = useAuthStore((s) => s.session?.userId ?? null);
  const isSuperAdmin = useIsSuperAdmin();
  const keyboardOffset = useKeyboardVerticalOffset({
    headerHeight: TAB_INLINE_FORM_HEADER_HEIGHT,
    contentBelowTopSafeArea: true,
  });

  const query = useQuery({
    queryKey: ['post', id, viewerId],
    queryFn: () => getPostByIdUseCase().execute({ postId: id ?? '', viewerId }),
    enabled: Boolean(id),
    staleTime: 60_000, // PERF-3: post detail — edit submission invalidates explicitly
  });

  const post = query.data?.post;
  const form = useEditPostForm(id, post);
  const { title, city, street, streetNumber, uploads, setUploads } = form;
  const [hideFromCounterparty, setHideFromCounterparty] = useState(false);
  const [notify, setNotify] = useState<{ title: string; message: string } | null>(null);

  const validation = useEditPostValidation({
    isGive: post?.type === 'Give',
    title,
    city,
    street,
    streetNumber,
    uploadsLength: uploads.length,
  });

  const profileQuery = useQuery({
    queryKey: ['user-profile', viewerId],
    queryFn: () => getUserRepo().findById(viewerId!),
    enabled: Boolean(viewerId),
    staleTime: 5 * 60_000, // PERF-3: profile (self) — edit-profile invalidates explicitly
  });

  const identityQuery = useQuery({
    queryKey: ['post-actor-identity', id],
    queryFn: () => getListPostActorIdentityUseCase().execute({ postId: id ?? '' }),
    enabled: Boolean(id) && Boolean(viewerId),
    staleTime: 5 * 60_000, // PERF-3: post actor identity (self) — upsert actions invalidate explicitly
  });

  useEffect(() => {
    if (!viewerId || identityQuery.data == null) return;
    const myIdentity = identityQuery.data.find((r) => r.userId === viewerId);
    setHideFromCounterparty(myIdentity?.hideFromCounterparty ?? false);
  }, [identityQuery.data, viewerId]);

  // FR-POST-005 AC5: photos that did upload stay in the gallery; only the failed ones need a retry.
  const onUploadFailures = useCallback(({ ok, total, firstError }: PostImageUploadSummary) => {
    const message = ok > 0 ? t('post.uploadPartial', { ok, total }) : uploadErrorMessage(firstError) || t('post.editPost.uploadFailedFallback');
    setNotify({ title: t('post.editPost.uploadFailedTitle'), message });
  }, [t]);
  const onMissingOwner = useCallback(() => {
    setNotify({ title: t('post.editPost.notifyErrorTitle'), message: t('post.editPost.needReauthBody') });
  }, [t]);
  const { uploadingCount, pickAndUpload: handlePickImages, cancelUploads } = usePostImageUploads({
    ownerId: viewerId,
    galleryCount: uploads.length,
    setUploads,
    onMissingOwner,
    onFailures: onUploadFailures,
  });

  const handleRemoveImage = (path: string) =>
    setUploads((prev) => prev.filter((u) => u.path !== path));

  const save = useEditPostSave({
    postId: id,
    viewerId,
    post,
    form,
    hideFromCounterparty,
    onFailure: setNotify,
  });

  // Loading / error / not-found guards.
  if (query.isLoading || (!form.seeded && post != null)) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (query.isError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>{t('post.editPost.loadErrorTitle')}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => query.refetch()}>
          <Text style={styles.retryText}>{t('post.editPost.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!post) {
    return (
      <SafeAreaView style={styles.container}>
        <EmptyState icon="search-outline" title={t('post.editPost.notFoundTitle')} subtitle={t('post.editPost.notFoundSubtitle')} />
      </SafeAreaView>
    );
  }

  const isOwner = viewerId !== null && post.ownerId === viewerId;
  const canEdit = isOwner || isSuperAdmin;
  if (!canEdit) {
    return (
      <SafeAreaView style={styles.container}>
        <EmptyState
          icon="lock-closed-outline"
          title={t('post.editPost.forbiddenTitle')}
          subtitle={t('post.editPost.forbiddenSubtitle')}
        />
      </SafeAreaView>
    );
  }

  if (!isPostEditableByOwner(post.status)) {
    if (postOwnerActions(post.status).republish && viewerId && post.ownerId === viewerId) {
      return (
        <SafeAreaView style={styles.container}>
          <ExpiredRepublishView
            postId={post.postId}
            viewerId={viewerId}
            onRepublished={(newId) => {
              queryClient.invalidateQueries({ queryKey: ['post'] });
              queryClient.invalidateQueries({ queryKey: ['profile-closed-posts'] });
              queryClient.invalidateQueries({ queryKey: ['my-posts'] });
              router.replace(`/post/${newId}`);
            }}
          />
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={styles.container}>
        <EmptyState
          icon="lock-closed-outline"
          title={t('post.editPost.notEditableTitle')}
          subtitle={post.status === 'expired' ? t('post.editPost.notEditableExpired') : t('post.editPost.notEditableRemoved')}
        />
      </SafeAreaView>
    );
  }

  const isGive = post.type === 'Give';
  const isSaving = save.isPending || uploadingCount > 0;

  // Save stays enabled: pressing it with something missing marks it and jumps there (FR-RESP-006 AC29).
  const onSavePress = () => {
    if (validation.acceptSubmit()) save.mutate();
  };

  const profilePrivacy = profileQuery.data?.privacyMode ?? 'Public';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerClose}>
          <Ionicons name="close" size={iconSize['2xl']} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('post.editPost.headerTitle')}</Text>
        <TouchableOpacity
          testID="edit-post-save"
          style={[styles.saveBtn, isSaving && { opacity: 0.5 }]}
          onPress={onSavePress}
          disabled={isSaving}
          accessibilityRole="button"
          accessibilityState={{ disabled: isSaving }}
        >
          {isSaving ? (
            <ActivityIndicator color={colors.textInverse} size="small" />
          ) : (
            <Text style={styles.saveBtnText}>{t('post.editPost.saveCta')}</Text>
          )}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={resolveKeyboardAvoidingBehavior(Platform.OS)}
        keyboardVerticalOffset={keyboardOffset}
      >
        <EditPostFormScrollContent
          fieldErrors={validation.fieldErrors}
          failedSubmitCount={validation.failedSubmitCount}
          isGive={isGive}
          isSaving={isSaving}
          uploads={uploads}
          uploadingCount={uploadingCount}
          onAddPhotos={handlePickImages}
          onCancelUploads={cancelUploads}
          onRemovePhoto={handleRemoveImage}
          title={title}
          onTitleChange={form.setTitle}
          city={city}
          onCityChange={form.setCity}
          street={street}
          onStreetChange={form.setStreet}
          streetNumber={streetNumber}
          onStreetNumberChange={form.setStreetNumber}
          description={form.description}
          onDescriptionChange={form.setDescription}
          category={form.category}
          onCategoryChange={form.setCategory}
          condition={form.condition}
          onConditionChange={form.setCondition}
          locationDisplayLevel={form.locationDisplayLevel}
          onLocationDisplayLevelChange={form.setLocationDisplayLevel}
          urgency={form.urgency}
          onUrgencyChange={form.setUrgency}
          visibility={form.visibility}
          onVisibilityChange={form.setVisibility}
          profilePrivacy={profilePrivacy}
          hideFromCounterparty={hideFromCounterparty}
          onHideFromCounterpartyChange={setHideFromCounterparty}
        />
      </KeyboardAvoidingView>
      <NotifyModal visible={notify !== null} title={notify?.title ?? ''} message={notify?.message ?? ''} onDismiss={() => setNotify(null)} />
    </SafeAreaView>
  );
}

// FR-POST-008, FR-POST-009, FR-POST-015 AC1, FR-ADMIN-006. Edit form for open posts (owner or super-admin).
// FR-POST-005 — images: same picker + upload pipeline as create.
// Closes TD-130.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { iconSize, useTheme, Text } from '@kc/ui';
import type { Category, ItemCondition, LocationDisplayLevel, PostVisibility } from '@kc/domain';
import { isPostError } from '@kc/application';
import { getSupabaseClient } from '@kc/infrastructure-supabase';
import { useAuthStore } from '../../src/store/authStore';
import { useIsSuperAdmin } from '../../src/hooks/useIsSuperAdmin';
import {
  getListPostActorIdentityUseCase,
  getPostByIdUseCase,
  getUpdatePostUseCase,
} from '../../src/services/postsComposition';
import { ExpiredRepublishView } from '../../src/components/post/ExpiredRepublishView';
import {
  newUploadBatchId,
  pickPostImages,
  resizeAndUploadImage,
  type UploadedAsset,
} from '../../src/services/imageUpload';
import { useAddressStateWithCityReset } from '../../src/hooks/useAddressStateWithCityReset';
import { EmptyState } from '../../src/components/EmptyState';
import { EditPostFormScrollContent } from '../../src/components/post/EditPostFormScrollContent';
import { mapPostErrorToHebrew } from '../../src/services/postMessages';
import { NotifyModal } from '../../src/components/NotifyModal';
import { syncOwnerPostActorIdentity } from '../../src/lib/syncOwnerPostActorIdentity';
import { getUserRepo } from '../../src/services/userComposition';
import { useEditPostScreenStyles } from '../../src/screens/edit-post/editPostScreen.styles';
import { useKeyboardVerticalOffset } from '../../src/lib/platform/useKeyboardVerticalOffset';
import { TAB_INLINE_FORM_HEADER_HEIGHT } from '../../src/lib/platform/formChromeHeights';
import { resolveKeyboardAvoidingBehavior } from '../../src/lib/platform/keyboardVerticalOffset';

const POST_IMAGES_BUCKET = 'post-images';
function assetUrl(path: string): string {
  return getSupabaseClient().storage.from(POST_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;
}

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

  // Form state — seeded once the post loads.
  const [seeded, setSeeded] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Category>('Other');
  const [condition, setCondition] = useState<ItemCondition>('Good');
  const [urgency, setUrgency] = useState('');
  const {
    city, street, streetNumber, setCity, setStreet, setStreetNumber,
  } = useAddressStateWithCityReset({});
  const addressSetters = useRef({ setCity, setStreet, setStreetNumber });
  addressSetters.current = { setCity, setStreet, setStreetNumber };
  const [locationDisplayLevel, setLocationDisplayLevel] =
    useState<LocationDisplayLevel>('CityAndStreet');
  const [visibility, setVisibility] = useState<PostVisibility>('Public');
  const [hideFromCounterparty, setHideFromCounterparty] = useState(false);
  const [uploads, setUploads] = useState<UploadedAsset[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [batchId] = useState(() => newUploadBatchId());
  const [notify, setNotify] = useState<{ title: string; message: string } | null>(null);

  const post = query.data?.post;

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
    setSeeded(false);
  }, [id]);

  useEffect(() => {
    if (!post || seeded) return;
    setTitle(post.title);
    setDescription(post.description ?? '');
    setCategory(post.category);
    setCondition(post.itemCondition ?? 'Good');
    setUrgency(post.urgency ?? '');
    addressSetters.current.setCity({ id: post.address.city, name: post.address.cityName });
    addressSetters.current.setStreet(post.address.street);
    addressSetters.current.setStreetNumber(post.address.streetNumber);
    setLocationDisplayLevel(post.locationDisplayLevel);
    setVisibility(post.visibility);
    setUploads(
      post.mediaAssets.map((a) => ({
        path: a.path,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        previewUri: assetUrl(a.path),
      })),
    );
    setSeeded(true);
  }, [post, seeded, setCity, setStreet, setStreetNumber]);

  useEffect(() => {
    if (!viewerId || identityQuery.data == null) return;
    const myIdentity = identityQuery.data.find((r) => r.userId === viewerId);
    setHideFromCounterparty(myIdentity?.hideFromCounterparty ?? false);
  }, [identityQuery.data, viewerId]);

  const handlePickImages = async () => {
    if (!viewerId) {
      setNotify({ title: t('post.editPost.notifyErrorTitle'), message: t('post.editPost.needReauthBody') });
      return;
    }
    const picked = await pickPostImages(uploads.length + uploadingCount);
    if (picked.length === 0) return;

    setUploadingCount((n) => n + picked.length);
    try {
      const startOrdinal = uploads.length;
      const results = await Promise.all(
        picked.map((p, i) => resizeAndUploadImage(p, viewerId, batchId, startOrdinal + i)),
      );
      setUploads((prev) => [...prev, ...results]);
    } catch (err) {
      setNotify({ title: t('post.editPost.uploadFailedTitle'), message: err instanceof Error ? err.message : t('post.editPost.uploadFailedFallback') });
    } finally {
      setUploadingCount((n) => Math.max(0, n - picked.length));
    }
  };

  const handleRemoveImage = (path: string) =>
    setUploads((prev) => prev.filter((u) => u.path !== path));

  const save = useMutation({
    mutationFn: async () => {
      if (!viewerId || !id) throw new Error('not_authenticated');
      if (!city) throw new Error('city_required');
      const updated = await getUpdatePostUseCase().execute({
        postId: id,
        viewerId,
        patch: {
          title,
          description: description.trim() ? description.trim() : null,
          category,
          address: { city: city.id, cityName: city.name, street, streetNumber },
          locationDisplayLevel,
          itemCondition: post?.type === 'Give' ? condition : null,
          urgency: post?.type !== 'Give' && urgency.trim() ? urgency.trim() : null,
          visibility,
          mediaAssets: uploads.map((u) => ({
            path: u.path,
            mimeType: u.mimeType,
            sizeBytes: u.sizeBytes,
          })),
        },
      });
      if (post?.ownerId === viewerId) {
        await syncOwnerPostActorIdentity({
          postId: id,
          ownerId: viewerId,
          visibility,
          hideFromCounterparty,
        });
      }
      return updated;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['post', id, viewerId] });
      await queryClient.invalidateQueries({ queryKey: ['post-actor-identity', id] });
      await queryClient.invalidateQueries({ queryKey: ['my-posts'] });
      await queryClient.invalidateQueries({ queryKey: ['my-hidden-open-posts'] });
      await queryClient.invalidateQueries({ queryKey: ['profile-closed-posts'] });
      await queryClient.invalidateQueries({ queryKey: ['profile-tab-open-count'] });
      await queryClient.invalidateQueries({ queryKey: ['profile-tab-closed-count'] });
      await queryClient.invalidateQueries({ queryKey: ['feed'] });
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)');
    },
    onError: (err) => {
      const message = isPostError(err) ? mapPostErrorToHebrew(err.code) : t('post.editPost.networkError');
      setNotify({ title: t('post.editPost.saveFailedTitle'), message });
    },
  });

  // Loading / error / not-found guards.
  if (query.isLoading || (!seeded && post != null)) {
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

  if (post.status !== 'open') {
    if (post.status === 'expired' && viewerId && post.ownerId === viewerId) {
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

  const isFormValid =
    title.trim().length > 0 &&
    city !== null &&
    street.trim().length > 0 &&
    streetNumber.trim().length > 0 &&
    (!isGive || uploads.length > 0);

  const profilePrivacy = profileQuery.data?.privacyMode ?? 'Public';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerClose}>
          <Ionicons name="close" size={iconSize['2xl']} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('post.editPost.headerTitle')}</Text>
        <TouchableOpacity
          style={[styles.saveBtn, (isSaving || !isFormValid) && { opacity: 0.5 }]}
          onPress={() => save.mutate()}
          disabled={isSaving || !isFormValid}
          accessibilityState={{ disabled: isSaving || !isFormValid }}
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
          isGive={isGive}
          isSaving={isSaving}
          uploads={uploads}
          uploadingCount={uploadingCount}
          onAddPhotos={handlePickImages}
          onRemovePhoto={handleRemoveImage}
          title={title}
          onTitleChange={setTitle}
          city={city}
          onCityChange={setCity}
          street={street}
          onStreetChange={setStreet}
          streetNumber={streetNumber}
          onStreetNumberChange={setStreetNumber}
          description={description}
          onDescriptionChange={setDescription}
          category={category}
          onCategoryChange={setCategory}
          condition={condition}
          onConditionChange={setCondition}
          locationDisplayLevel={locationDisplayLevel}
          onLocationDisplayLevelChange={setLocationDisplayLevel}
          urgency={urgency}
          onUrgencyChange={setUrgency}
          visibility={visibility}
          onVisibilityChange={setVisibility}
          profilePrivacy={profilePrivacy}
          hideFromCounterparty={hideFromCounterparty}
          onHideFromCounterpartyChange={setHideFromCounterparty}
        />
      </KeyboardAvoidingView>
      <NotifyModal visible={notify !== null} title={notify?.title ?? ''} message={notify?.message ?? ''} onDismiss={() => setNotify(null)} />
    </SafeAreaView>
  );
}

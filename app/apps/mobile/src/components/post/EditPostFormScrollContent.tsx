// Mapped to spec: FR-POST-008 / FR-RESP-006 AC28–AC30 — the items edit form, in the create form's
// order. A rejected save marks the title, photo and address under each part and jumps to the first.
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@kc/ui';
import { TextField } from '../ui/TextField';
import { StreetAddressRow } from '../address/StreetAddressRow';
import { ALL_CATEGORIES, ITEM_CONDITIONS } from '@kc/domain';
import type { Category, ItemCondition, LocationDisplayLevel, PostVisibility } from '@kc/domain';
import { CityPicker } from '../CityPicker';
import { PhotoPicker } from '../CreatePostForm/PhotoPicker';
import { ExposureSettingsSection } from './ExposureSettingsSection';
import type { UploadedAsset } from '../../services/imageUpload';
import { useEditPostScreenStyles } from '../../screens/edit-post/editPostScreen.styles';
import { FormScrollView } from '../ui/FormScrollView';
import { FormSection } from '../ui/FormSection';
import { FilterChipRow } from '../filterKit/FilterChipRow';
import type { PostFieldErrors } from '../../lib/createPostFieldValidation';

export interface EditPostFormScrollContentProps {
  /** What a rejected save marks under each required part. */
  readonly fieldErrors: PostFieldErrors;
  /** Rejected saves so far: each one jumps to the first problem again. */
  readonly failedSubmitCount: number;
  readonly isGive: boolean;
  readonly isSaving: boolean;
  readonly uploads: UploadedAsset[];
  readonly uploadingCount: number;
  readonly onAddPhotos: () => void;
  readonly onRemovePhoto: (path: string) => void;
  readonly title: string;
  readonly onTitleChange: (next: string) => void;
  readonly city: { id: string; name: string } | null;
  readonly onCityChange: (selection: { id: string; name: string }) => void;
  readonly street: string;
  readonly onStreetChange: (next: string) => void;
  readonly streetNumber: string;
  readonly onStreetNumberChange: (next: string) => void;
  readonly description: string;
  readonly onDescriptionChange: (next: string) => void;
  readonly category: Category;
  readonly onCategoryChange: (next: Category) => void;
  readonly condition: ItemCondition;
  readonly onConditionChange: (next: ItemCondition) => void;
  readonly locationDisplayLevel: LocationDisplayLevel;
  readonly onLocationDisplayLevelChange: (next: LocationDisplayLevel) => void;
  readonly urgency: string;
  readonly onUrgencyChange: (next: string) => void;
  readonly visibility: PostVisibility;
  readonly onVisibilityChange: (next: PostVisibility) => void;
  readonly profilePrivacy: 'Public' | 'Private';
  readonly hideFromCounterparty: boolean;
  readonly onHideFromCounterpartyChange: (next: boolean) => void;
}

export function EditPostFormScrollContent({
  fieldErrors,
  failedSubmitCount,
  isGive,
  isSaving,
  uploads,
  uploadingCount,
  onAddPhotos,
  onRemovePhoto,
  title,
  onTitleChange,
  city,
  onCityChange,
  street,
  onStreetChange,
  streetNumber,
  onStreetNumberChange,
  description,
  onDescriptionChange,
  category,
  onCategoryChange,
  condition,
  onConditionChange,
  locationDisplayLevel,
  onLocationDisplayLevelChange,
  urgency,
  onUrgencyChange,
  visibility,
  onVisibilityChange,
  profilePrivacy,
  hideFromCounterparty,
  onHideFromCounterpartyChange,
}: EditPostFormScrollContentProps) {
  const { t } = useTranslation();
  const styles = useEditPostScreenStyles();
  return (
    <FormScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      jumpToProblemSignal={failedSubmitCount}
    >
      <View style={[styles.typeBadge, isGive ? styles.typeBadgeGive : styles.typeBadgeRequest]}>
        <Text style={styles.typeBadgeText}>
          {isGive ? t('post.editPost.typeBadgeGive') : t('post.editPost.typeBadgeRequest')}
        </Text>
        <Text style={styles.typeBadgeSub}>{t('post.editPost.typeBadgeSub')}</Text>
      </View>

      <FormSection error={fieldErrors.photo} testID="edit-post-photos">
        <PhotoPicker
          uploads={uploads}
          isUploading={uploadingCount > 0}
          uploadingCount={uploadingCount}
          required={isGive}
          onAdd={onAddPhotos}
          onRemove={onRemovePhoto}
        />
      </FormSection>

      <FormSection outlined={false}>
        <TextField
          testID="edit-post-title"
          label={`${t('post.editPost.sectionTitle')} *`}
          errorText={fieldErrors.title ?? undefined}
          value={title}
          onChangeText={onTitleChange}
          placeholder={t('post.editPost.titlePlaceholder')}
          maxLength={80}
        />
        <Text style={styles.charCount}>{title.length}/80</Text>
      </FormSection>

      <FormSection label={t('post.editPost.sectionAddress')} required error={fieldErrors.address} outlined={false}>
        <CityPicker value={city} onChange={onCityChange} disabled={isSaving} />
        <StreetAddressRow
          cityId={city?.id ?? null}
          street={street}
          streetNumber={streetNumber}
          onStreetChange={onStreetChange}
          onStreetNumberChange={onStreetNumberChange}
          disabled={isSaving}
          streetNumberPlaceholder={t('post.editPost.streetNumberPlaceholder')}
        />
      </FormSection>

      <FormSection label={t('post.editPost.sectionCategory')}>
        <FilterChipRow<Category>
          testID="edit-post-category"
          chipSize="md"
          options={ALL_CATEGORIES.map((cat) => ({ value: cat, label: t(`post.category.${cat}`) }))}
          value={category}
          onChange={(next) => next && onCategoryChange(next)}
        />
      </FormSection>

      {isGive && (
        <FormSection label={t('post.editPost.sectionCondition')}>
          <FilterChipRow<ItemCondition>
            testID="edit-post-condition"
            chipSize="md"
            options={ITEM_CONDITIONS.map((c) => ({ value: c, label: t(`post.condition.${c}`) }))}
            value={condition}
            onChange={(next) => next && onConditionChange(next)}
          />
        </FormSection>
      )}

      <FormSection outlined={false}>
        <TextField
          label={t('post.editPost.sectionDescription')}
          value={description}
          onChangeText={onDescriptionChange}
          placeholder={t('post.editPost.descriptionPlaceholder')}
          multiline
          maxLength={500}
        />
        <Text style={styles.charCount}>{description.length}/500</Text>
      </FormSection>

      {!isGive && (
        <FormSection outlined={false}>
          <TextField
            label={t('post.editPost.sectionUrgency')}
            value={urgency}
            onChangeText={onUrgencyChange}
            placeholder={t('post.editPost.urgencyPlaceholder')}
            maxLength={100}
          />
        </FormSection>
      )}

      <ExposureSettingsSection
        locationDisplayLevel={locationDisplayLevel}
        onLocationDisplayLevelChange={onLocationDisplayLevelChange}
        visibility={visibility}
        onVisibilityChange={onVisibilityChange}
        profilePrivacy={profilePrivacy}
        hideFromCounterparty={hideFromCounterparty}
        onHideFromCounterpartyChange={onHideFromCounterpartyChange}
        disabled={isSaving}
      />
    </FormScrollView>
  );
}

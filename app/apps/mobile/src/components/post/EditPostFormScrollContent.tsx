import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@kc/ui';
import { TextField } from '../ui/TextField';
import { CompactStreetNumberField } from '../address/CompactStreetNumberField';
import { ALL_CATEGORIES, ITEM_CONDITIONS } from '@kc/domain';
import type { Category, ItemCondition, LocationDisplayLevel, PostVisibility } from '@kc/domain';
import { CityPicker } from '../CityPicker';
import { StreetPicker } from '../StreetPicker';
import { PhotoPicker } from '../CreatePostForm/PhotoPicker';
import { ExposureSettingsSection } from './ExposureSettingsSection';
import type { UploadedAsset } from '../../services/imageUpload';
import { useEditPostScreenStyles } from '../../screens/edit-post/editPostScreen.styles';
import { FormScrollView } from '../ui/FormScrollView';
import { FormSection } from '../ui/FormSection';
import { FilterChipRow } from '../filterKit/FilterChipRow';

export interface EditPostFormScrollContentProps {
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
    <FormScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <View style={[styles.typeBadge, isGive ? styles.typeBadgeGive : styles.typeBadgeRequest]}>
        <Text style={styles.typeBadgeText}>
          {isGive ? t('post.editPost.typeBadgeGive') : t('post.editPost.typeBadgeRequest')}
        </Text>
        <Text style={styles.typeBadgeSub}>{t('post.editPost.typeBadgeSub')}</Text>
      </View>

      <FormSection testID="edit-post-photos">
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
          label={`${t('post.editPost.sectionTitle')} *`}
          value={title}
          onChangeText={onTitleChange}
          placeholder={t('post.editPost.titlePlaceholder')}
          maxLength={80}
        />
        <Text style={styles.charCount}>{title.length}/80</Text>
      </FormSection>

      <FormSection label={t('post.editPost.sectionAddress')} required outlined={false}>
        <CityPicker value={city} onChange={onCityChange} disabled={isSaving} />
        <View style={styles.streetRow}>
          <View style={styles.streetInputStreet}>
            <StreetPicker
              cityId={city?.id ?? null}
              value={street ? { id: '', name: street } : null}
              onChange={(sel) => onStreetChange(sel.name)}
              disabled={isSaving}
            />
          </View>
          <CompactStreetNumberField
            containerStyle={styles.streetInputHouse}
            value={streetNumber}
            onChangeText={onStreetNumberChange}
            placeholder={t('post.editPost.streetNumberPlaceholder')}
            editable={!isSaving && !!city}
          />
        </View>
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

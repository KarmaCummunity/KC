import React, { useMemo } from 'react';
import { ScrollView, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@kc/ui';
import { TextField } from '../ui/TextField';
import { CompactStreetNumberField } from '../address/CompactStreetNumberField';
import { ALL_CATEGORIES, ITEM_CONDITIONS } from '@kc/domain';
import type { Category, ItemCondition, LocationDisplayLevel, PostVisibility } from '@kc/domain';
import { CityPicker } from '../CityPicker';
import { StreetPicker } from '../StreetPicker';
import { LocationDisplayLevelChooser } from '../CreatePostForm/LocationDisplayLevelChooser';
import { PhotoPicker } from '../CreatePostForm/PhotoPicker';
import { EditPostExposureSection } from './EditPostExposureSection';
import type { UploadedAsset } from '../../services/imageUpload';
import { useEditPostScreenStyles } from '../../screens/edit-post/editPostScreen.styles';
import { useFormFieldFocus } from '../../hooks/useFormFieldFocus';
import { KeyboardFormAccessory } from '../ui/KeyboardFormAccessory';

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
  const textFieldCount = isGive ? 3 : 4;
  const fieldFocus = useFormFieldFocus(textFieldCount);
  const titleField = fieldFocus.bindField(0);
  const streetNumberField = fieldFocus.bindField(1);
  const descriptionField = fieldFocus.bindField(2);
  const urgencyField = useMemo(
    () => (isGive ? null : fieldFocus.bindField(3)),
    [fieldFocus, isGive],
  );

  return (
    <>
      <KeyboardFormAccessory
        canGoPrev={fieldFocus.canGoPrev}
        canGoNext={fieldFocus.canGoNext}
        onPrev={fieldFocus.focusPrev}
        onNext={fieldFocus.focusNext}
        onDone={fieldFocus.dismiss}
      />
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.typeBadge, isGive ? styles.typeBadgeGive : styles.typeBadgeRequest]}>
        <Text style={styles.typeBadgeText}>
          {isGive ? t('post.editPost.typeBadgeGive') : t('post.editPost.typeBadgeRequest')}
        </Text>
        <Text style={styles.typeBadgeSub}>{t('post.editPost.typeBadgeSub')}</Text>
      </View>

      <PhotoPicker
        uploads={uploads}
        isUploading={uploadingCount > 0}
        uploadingCount={uploadingCount}
        required={isGive}
        onAdd={onAddPhotos}
        onRemove={onRemovePhoto}
      />

      <View style={styles.section}>
        <TextField
          ref={titleField.ref}
          label={`${t('post.editPost.sectionTitle')} *`}
          value={title}
          onChangeText={onTitleChange}
          placeholder={t('post.editPost.titlePlaceholder')}
          maxLength={80}
          onFocus={titleField.onFocus}
          inputAccessoryViewID={titleField.inputAccessoryViewID}
          returnKeyType={titleField.returnKeyType}
          blurOnSubmit={titleField.blurOnSubmit}
          onSubmitEditing={titleField.onSubmitEditing}
        />
        <Text style={styles.charCount}>{title.length}/80</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>
          {t('post.editPost.sectionAddress')} <Text style={styles.required}>*</Text>
        </Text>
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
            ref={streetNumberField.ref}
            containerStyle={styles.streetInputHouse}
            value={streetNumber}
            onChangeText={onStreetNumberChange}
            placeholder={t('post.editPost.streetNumberPlaceholder')}
            editable={!isSaving && !!city}
            onFocus={streetNumberField.onFocus}
            inputAccessoryViewID={streetNumberField.inputAccessoryViewID}
            returnKeyType={streetNumberField.returnKeyType}
            blurOnSubmit={streetNumberField.blurOnSubmit}
            onSubmitEditing={streetNumberField.onSubmitEditing}
          />
        </View>
      </View>

      <View style={styles.section}>
        <TextField
          ref={descriptionField.ref}
          label={t('post.editPost.sectionDescription')}
          value={description}
          onChangeText={onDescriptionChange}
          placeholder={t('post.editPost.descriptionPlaceholder')}
          multiline
          maxLength={500}
          onFocus={descriptionField.onFocus}
          inputAccessoryViewID={descriptionField.inputAccessoryViewID}
          returnKeyType={descriptionField.returnKeyType}
          blurOnSubmit={descriptionField.blurOnSubmit}
          onSubmitEditing={descriptionField.onSubmitEditing}
        />
        <Text style={styles.charCount}>{description.length}/500</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t('post.editPost.sectionCategory')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
          {ALL_CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat}
              style={[styles.chip, category === cat && styles.chipActive]}
              onPress={() => onCategoryChange(cat)}
            >
              <Text style={[styles.chipText, category === cat && styles.chipTextActive]}>
                {t(`post.category.${cat}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {isGive && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('post.editPost.sectionCondition')}</Text>
          <View style={styles.conditionRow}>
            {ITEM_CONDITIONS.map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.conditionBtn, condition === c && styles.conditionBtnActive]}
                onPress={() => onConditionChange(c)}
              >
                <Text style={[styles.conditionText, condition === c && styles.conditionTextActive]}>
                  {t(`post.condition.${c}`)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      <LocationDisplayLevelChooser
        value={locationDisplayLevel}
        onChange={onLocationDisplayLevelChange}
        disabled={isSaving}
      />

      {!isGive && (
        <View style={styles.section}>
          <TextField
            ref={urgencyField?.ref}
            label={t('post.editPost.sectionUrgency')}
            value={urgency}
            onChangeText={onUrgencyChange}
            placeholder={t('post.editPost.urgencyPlaceholder')}
            maxLength={100}
            onFocus={urgencyField?.onFocus}
            inputAccessoryViewID={urgencyField?.inputAccessoryViewID}
            returnKeyType={urgencyField?.returnKeyType}
            blurOnSubmit={urgencyField?.blurOnSubmit}
            onSubmitEditing={urgencyField?.onSubmitEditing}
          />
        </View>
      )}

      <EditPostExposureSection
        visibility={visibility}
        onVisibilityChange={onVisibilityChange}
        profilePrivacy={profilePrivacy}
        hideFromCounterparty={hideFromCounterparty}
        onHideFromCounterpartyChange={onHideFromCounterpartyChange}
        disabled={isSaving}
      />
    </ScrollView>
    </>
  );
}

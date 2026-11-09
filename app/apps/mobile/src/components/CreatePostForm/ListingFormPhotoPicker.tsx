// Mapped to spec: FR-POST-001 AC6 + D127 — the listing form's photos: the ones the member picks on
// this device and, when republishing, the source post's photos that the new post reuses.
import React, { type Dispatch, type SetStateAction } from 'react';
import { MAX_MEDIA_ASSETS } from '@kc/domain';
import { listingImagePublicUrl, pickListingImages, type PickedImage } from '../../services/listingImageUpload';
import { PhotoPicker, type PhotoPickerItem } from './PhotoPicker';

interface Props {
  /** Photos picked on this device, uploaded on publish. */
  readonly photos: readonly PickedImage[];
  readonly setPhotos: Dispatch<SetStateAction<PickedImage[]>>;
  /** Storage paths of the republish source's photos (empty outside a republish). */
  readonly carriedMediaPaths: readonly string[];
  readonly onRemoveCarried: (path: string) => void;
}

export function ListingFormPhotoPicker({ photos, setPhotos, carriedMediaPaths, onRemoveCarried }: Props) {
  // Carried photos come first, in the source's order; their key is the storage path.
  const carried: PhotoPickerItem[] = carriedMediaPaths.map((path) => ({ path, previewUri: listingImagePublicUrl(path) }));
  const picked: PhotoPickerItem[] = photos.map((p) => ({ path: p.uri, previewUri: p.uri }));
  // Room left for new photos once the carried ones are counted.
  const room = Math.max(0, MAX_MEDIA_ASSETS - carriedMediaPaths.length);

  const addPhotos = async () => {
    const next = await pickListingImages(photos.length + carriedMediaPaths.length);
    if (next.length > 0) setPhotos((prev) => [...prev, ...next].slice(0, room));
  };

  /** A storage path is a carried photo; anything else is a picked photo's local uri. */
  const remove = (path: string) => {
    if (carriedMediaPaths.includes(path)) onRemoveCarried(path);
    else setPhotos((prev) => prev.filter((p) => p.uri !== path));
  };

  return (
    <PhotoPicker
      uploads={[...carried, ...picked]}
      isUploading={false}
      uploadingCount={0}
      required={false}
      onAdd={() => void addPhotos()}
      onRemove={remove}
    />
  );
}

// FR-POST-008 / FR-POST-009 / FR-POST-005: the edit form's field state, seeded once from the
// loaded post. Split out of `app/edit-post/[id].tsx` so the screen stays under the 300-line cap
// (#1752); behavior is unchanged.
import { useEffect, useRef, useState } from 'react';
import type { Category, ItemCondition, LocationDisplayLevel, Post, PostVisibility } from '@kc/domain';
import type { UploadedAsset } from '../services/imageUpload';
import { getSupabaseImageThumbUrl, getSupabasePublicImageUrl } from '../lib/imageUrl';
import { useAddressStateWithCityReset } from './useAddressStateWithCityReset';

const POST_IMAGES_BUCKET = 'post-images';

/** Gallery tile of one stored photo: the 400 px thumb, with the original as fallback for photos stored before thumbs existed. */
export function uploadedAssetFromMedia(asset: Post['mediaAssets'][number]): UploadedAsset {
  return {
    path: asset.path,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    previewUri: getSupabaseImageThumbUrl({ bucket: POST_IMAGES_BUCKET, path: asset.path }),
    previewFallbackUri: getSupabasePublicImageUrl({ bucket: POST_IMAGES_BUCKET, path: asset.path }),
  };
}

/**
 * Field state of the edit form. Seeds every field from `post` the first time it is available
 * for `postId`, then leaves them to the member; `seeded` is false until that happens.
 */
export function useEditPostForm(postId: string | undefined, post: Post | null | undefined) {
  const [seeded, setSeeded] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Category>('Other');
  const [condition, setCondition] = useState<ItemCondition>('Good');
  const [urgency, setUrgency] = useState('');
  const address = useAddressStateWithCityReset({});
  // The address setters change identity on every render; the seed effect reads them through a ref
  // so it runs once per post, not once per render.
  const addressSetters = useRef(address);
  addressSetters.current = address;
  const [locationDisplayLevel, setLocationDisplayLevel] = useState<LocationDisplayLevel>('CityAndStreet');
  const [visibility, setVisibility] = useState<PostVisibility>('Public');
  const [uploads, setUploads] = useState<UploadedAsset[]>([]);

  // A different post id starts a fresh seed.
  useEffect(() => {
    setSeeded(false);
  }, [postId]);

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
    setUploads(post.mediaAssets.map(uploadedAssetFromMedia));
    setSeeded(true);
  }, [post, seeded]);

  return {
    seeded,
    title, setTitle,
    description, setDescription,
    category, setCategory,
    condition, setCondition,
    urgency, setUrgency,
    city: address.city, setCity: address.setCity,
    street: address.street, setStreet: address.setStreet,
    streetNumber: address.streetNumber, setStreetNumber: address.setStreetNumber,
    locationDisplayLevel, setLocationDisplayLevel,
    visibility, setVisibility,
    uploads, setUploads,
  };
}

export type EditPostForm = ReturnType<typeof useEditPostForm>;

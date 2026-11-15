// FR-POST-019 AC5 — the location line of a post, as its display level shows it:
//   CityOnly → "city" · CityAndStreet → "city, street" · FullAddress → "city, street number".
// The street comes from the server only when the poster's level shows it (migration 0029), so an
// empty street always falls back to the city alone instead of leaving a dangling separator.
import type { LocationDisplayLevel } from '@kc/domain';

export interface PostLocationSource {
  readonly locationDisplayLevel: LocationDisplayLevel;
  readonly address: { readonly cityName: string; readonly street: string; readonly streetNumber: string };
}

/** `streetPrefix`, when given, is written before a street shown without its number (the detail screen). */
export function postLocationText(post: PostLocationSource, streetPrefix?: string): string {
  const city = post.address.cityName;
  const street = post.address.street.trim();
  if (post.locationDisplayLevel === 'CityOnly' || street === '') return city;
  const number = post.address.streetNumber.trim();
  if (post.locationDisplayLevel === 'FullAddress' && number !== '') return `${city}, ${street} ${number}`;
  return streetPrefix ? `${city}, ${streetPrefix} ${street}` : `${city}, ${street}`;
}

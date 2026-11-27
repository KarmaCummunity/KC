import { describe, expect, it } from 'vitest';
import { mapGuestPostRow } from '../mapGuestPostRow';

const base = {
  id: '40000000-0000-4000-8000-000000000001',
  title: 'Desk',
  description: 'A desk',
  city_name_he: 'לוד',
  city_name_en: 'Lod',
};

describe('mapGuestPostRow', () => {
  it('maps a public author handle onto the guest post DTO', () => {
    expect(mapGuestPostRow({ ...base, author_share_handle: ' alice ' })).toEqual({
      id: base.id,
      title: 'Desk',
      description: 'A desk',
      cityNameHe: 'לוד',
      cityNameEn: 'Lod',
      authorShareHandle: 'alice',
    });
  });

  it('coerces a missing or blank author handle to null', () => {
    expect(mapGuestPostRow({ ...base, author_share_handle: null }).authorShareHandle).toBeNull();
    expect(mapGuestPostRow({ ...base, author_share_handle: '' }).authorShareHandle).toBeNull();
    expect(mapGuestPostRow({ ...base, author_share_handle: '  ' }).authorShareHandle).toBeNull();
  });
});

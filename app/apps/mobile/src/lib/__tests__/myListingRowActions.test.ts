import { describe, expect, it } from 'vitest';
import { myListingRowActions } from '../myListingRowActions';

/** The names of the buttons shown for `status`. */
function shown(status: string): string {
  return Object.entries(myListingRowActions(status))
    .filter(([, on]) => on)
    .map(([name]) => name)
    .join(',');
}

describe('myListingRowActions', () => {
  it('shows on each status the buttons the post machine allows its owner', () => {
    expect(shown('open')).toBe('edit,pause,fulfill,addPhotos,delete');
    expect(shown('paused')).toBe('edit,resume,addPhotos,delete');
    expect(shown('closed_delivered')).toBe('addPhotos,delete');
    expect(shown('expired')).toBe('addPhotos,delete');
    expect(shown('hidden_pending_review')).toBe('delete');
    expect(shown('removed_admin')).toBe('');
  });

  it('does not offer Delete on a listing that is already deleted', () => {
    expect(shown('deleted_no_recipient')).toBe('addPhotos');
  });
});

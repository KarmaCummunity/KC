// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';
const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), push: vi.fn(), replace: vi.fn(), capture: vi.fn() }));
vi.mock('../../../services/guestPostsComposition', () => ({ guestPosts: { list: mocks.list, get: mocks.get } }));
vi.mock('@expo/vector-icons', async () => (await import('../../../components/ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('react-native-reanimated', async () => (await import('../../../components/ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('../../../components/ui/KCImage', () => ({ KCImage: () => null }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => (opts ? `${k}:${JSON.stringify(opts)}` : k),
    i18n: { language: 'en' },
  }),
}));
vi.mock('../../../store/redirectIntentStore', () => ({ useRedirectIntentStore: { getState: () => ({ capturePath: mocks.capture }) } }));
import { GuestBrowseScreen } from '../GuestBrowseScreen';
const id = '40000000-0000-4000-8000-000000000001';
const post = {
  id, title: 'Desk to give', description: 'A small desk', cityNameEn: 'Lod', cityNameHe: 'City',
  authorShareHandle: null as string | null,
};
function show(postId?: string) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}><GuestBrowseScreen postId={postId} /></ThemeProvider>
  </QueryClientProvider>);
}
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue([post]); mocks.get.mockResolvedValue(post); });
describe('read-only guest screen', () => {
  it('renders only title description city and opens dedicated guest detail', async () => {
    show();
    expect(await screen.findByText('Desk to give')).toBeTruthy();
    expect(screen.getByText('A small desk')).toBeTruthy(); expect(screen.getByText('Lod')).toBeTruthy();
    expect(mocks.get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId(`guest-post-${id}`));
    expect(mocks.push).toHaveBeenCalledWith({ pathname: '/browse/post/[id]', params: { id } });
    // Write actions stay off the guest surface (prompt only via the explicit sign-in CTA).
    for (const write of ['comment', 'follow', 'save', 'report', 'request', 'chat']) {
      expect(screen.queryByText(write)).toBeNull();
    }
    fireEvent.click(screen.getByTestId('guest-map-link'));
    expect(mocks.push).toHaveBeenCalledWith('/browse/map');
  });
  it('does not load feed on detail and saves only member intent when sign in is tapped', async () => {
    show(id); await screen.findByText('Desk to give');
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.capture).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('guest-sign-in'));
    expect(mocks.capture).toHaveBeenCalledWith(`/post/${id}`);
    expect(mocks.push).toHaveBeenCalledWith('/(auth)');
  });
  it('has an honest empty state, not a compulsory sign-in wall', async () => {
    mocks.list.mockResolvedValue([]); show();
    expect(await screen.findByTestId('guest-empty')).toBeTruthy();
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it('private/missing detail shares one unavailable state', async () => {
    mocks.get.mockResolvedValue(null); show(id);
    expect(await screen.findByText('auth.guestUnavailable')).toBeTruthy();
  });
  it('shows a retriable error rather than silently empty content', async () => {
    mocks.list.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([post]); show();
    fireEvent.click(await screen.findByText('general.retry'));
    await screen.findByText('Desk to give'); expect(mocks.list).toHaveBeenCalledTimes(2);
  });
  it('paginates without broad or member calls', async () => {
    const rows = Array.from({ length: 20 }, (_, n) => ({ ...post, id: `${id.slice(0,-2)}${String(n).padStart(2,'0')}` }));
    mocks.list.mockResolvedValueOnce(rows).mockResolvedValueOnce([]); show();
    fireEvent.click(await screen.findByText('auth.guestMore'));
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(rows.at(-1)?.id));
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it('shows an author link only when authorShareHandle is present', async () => {
    mocks.list.mockResolvedValue([{ ...post, authorShareHandle: 'alice' }]);
    show();
    expect(await screen.findByTestId('guest-author-alice')).toBeTruthy();
    fireEvent.click(screen.getByTestId('guest-author-alice'));
    expect(mocks.push).toHaveBeenCalledWith('/browse/user/alice');
  });
  it('omits the author link when the handle is null (no dead end)', async () => {
    show();
    await screen.findByText('Desk to give');
    expect(screen.queryByTestId('guest-author-alice')).toBeNull();
    expect(screen.queryByText(/^@/)).toBeNull();
  });
  it('keeps the author link tappable on guest post detail', async () => {
    mocks.get.mockResolvedValue({ ...post, authorShareHandle: 'alice' });
    show(id);
    fireEvent.click(await screen.findByTestId('guest-author-alice'));
    expect(mocks.push).toHaveBeenCalledWith('/browse/user/alice');
  });
});

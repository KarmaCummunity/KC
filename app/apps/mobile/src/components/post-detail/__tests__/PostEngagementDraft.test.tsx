// @vitest-environment jsdom
// NFR-PERF-005 — the comment draft lives in the composer, so a keystroke never re-renders the
// thread (up to 120 comments) that reads the engagement context.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';

const repo = vi.hoisted(() => ({ createComment: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/container', () => ({ container: { postEngagement: repo } }));
vi.mock('../../../lib/haptics', () => ({ hapticSuccess: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
vi.mock('@expo/vector-icons', async () => (await import('../../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('../../../navigation/useShellTabBarVisibility', () => ({ useShellTabBarScrollInset: () => 0 }));
vi.mock('../PostCommentRow', () => ({ PostCommentRow: () => null }));
vi.mock('../../../hooks/usePostEngagementSnapshot', () => {
  // Stable references, like the real cached snapshot: only a real change may produce new ones.
  const snapshot = {
    stats: { reactionCount: 0, commentCount: 0 },
    activeReaction: null,
    comments: [],
    commentsFailed: false,
  };
  return {
    usePostEngagementSnapshot: () => ({ snapshot, loaded: true, refresh, patch: vi.fn(), restore: vi.fn() }),
    withReaction: vi.fn(),
    withCommentLike: vi.fn(),
  };
});

import { PostEngagementProvider, usePostEngagement } from '../PostEngagementContext';
import { PostEngagementThread } from '../PostEngagementThread';
import { PostEngagementComposer } from '../PostEngagementComposer';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Subscribes to the same context as the thread, so it renders exactly when the thread would.
function ThreadRenderProbe({ onRender }: Readonly<{ onRender: () => void }>) {
  usePostEngagement();
  onRender();
  return null;
}

function renderScreen(onThreadRender: () => void) {
  return render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <PostEngagementProvider postId="p1" viewerId="u1">
        <ThreadRenderProbe onRender={onThreadRender} />
        <PostEngagementThread />
        <PostEngagementComposer embedded />
      </PostEngagementProvider>
    </ThemeProvider>,
  );
}

describe('comment draft ownership', () => {
  it('does not re-render the thread when the draft changes', () => {
    const onThreadRender = vi.fn();
    const { getByRole } = renderScreen(onThreadRender);
    const input = getByRole('textbox');
    const rendersBeforeTyping = onThreadRender.mock.calls.length;
    expect(rendersBeforeTyping).toBeGreaterThan(0);

    fireEvent.change(input, { target: { value: 'h' } });
    fireEvent.change(input, { target: { value: 'hi' } });

    expect((input as HTMLTextAreaElement).value).toBe('hi');
    expect(onThreadRender.mock.calls).toHaveLength(rendersBeforeTyping);
  });

  it('submits the typed text, then clears the draft', async () => {
    repo.createComment.mockResolvedValue(undefined);
    refresh.mockResolvedValue(undefined);
    const { getByRole } = renderScreen(vi.fn());
    const input = getByRole('textbox') as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: '  hello  ' } });
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'post.engagement.commentSend' }));
    });

    await waitFor(() => expect(input.value).toBe(''));
    expect(repo.createComment).toHaveBeenCalledWith('p1', 'hello', null);
  });
});

// #2239: a refused/offline write must keep the draft and settle without an unhandled rejection.
it('reports a failed write, keeps the draft and permits retry', async () => {
 repo.createComment.mockRejectedValueOnce(new Error('private backend detail')).mockResolvedValueOnce(undefined);
 refresh.mockResolvedValue(undefined);
 const {getByRole}=renderScreen(vi.fn());
 const input=getByRole('textbox') as HTMLTextAreaElement;
 fireEvent.change(input,{target:{value:'  keep this  '}});
 await act(async()=>{fireEvent.click(getByRole('button',{name:'post.engagement.commentSend'}));});
 await waitFor(()=>expect(getByRole('alert').textContent).toBe('post.engagement.commentSendFailed'));
 expect(input.value).toBe('  keep this  ');expect(refresh).not.toHaveBeenCalled();
 expect(getByRole('button',{name:'post.engagement.commentSend'})).not.toHaveProperty('disabled', true);
 await act(async()=>{fireEvent.click(getByRole('button',{name:'post.engagement.commentSend'}));});
 await waitFor(()=>expect(input.value).toBe(''));expect(repo.createComment).toHaveBeenCalledTimes(2);
});

it('does not turn a stored comment into a retryable failed write when refresh rejects', async()=>{
 repo.createComment.mockResolvedValue(undefined);refresh.mockRejectedValueOnce(new Error('refresh unavailable'));
 const {getByRole,queryByRole}=renderScreen(vi.fn());const input=getByRole('textbox') as HTMLTextAreaElement;
 fireEvent.change(input,{target:{value:'stored'}});await act(async()=>{fireEvent.click(getByRole('button',{name:'post.engagement.commentSend'}));});
 await waitFor(()=>expect(input.value).toBe(''));expect(queryByRole('alert')).toBeNull();
 expect(repo.createComment).toHaveBeenCalledTimes(1);
});
function ReplyButton(){const engagement=usePostEngagement();return <button onClick={()=>engagement?.onReply({commentId:'c1',authorLabel:'Alex'})}>target reply</button>;}
it('preserves the reply target after failure and clears the failure on a successful retry',async()=>{
 repo.createComment.mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined);refresh.mockResolvedValue(undefined);
 const {getByRole,queryByRole}=render(<ThemeProvider mode="light" systemScheme="light" setMode={()=>{}}><PostEngagementProvider postId="p1" viewerId="u1"><ReplyButton/><PostEngagementComposer embedded/></PostEngagementProvider></ThemeProvider>);
 fireEvent.click(getByRole('button',{name:'target reply'}));const input=getByRole('textbox') as HTMLTextAreaElement;fireEvent.change(input,{target:{value:'reply'}});
 await act(async()=>{fireEvent.click(getByRole('button',{name:'post.engagement.commentSend'}));});await waitFor(()=>expect(getByRole('alert')).toBeTruthy());
 expect(getByRole('button',{name:'post.engagement.cancelReply'})).toBeTruthy();
 await act(async()=>{fireEvent.click(getByRole('button',{name:'post.engagement.commentSend'}));});
 expect(repo.createComment).toHaveBeenNthCalledWith(2,'p1','reply','c1');expect(queryByRole('alert')).toBeNull();expect(queryByRole('button',{name:'post.engagement.cancelReply'})).toBeNull();
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
import { NotificationInboxRow } from '../NotificationInboxRow';

vi.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

afterEach(cleanup);

const withTheme = (ui: React.ReactElement) =>
  render(<ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>{ui}</ThemeProvider>);

describe('NotificationInboxRow', () => {
  it('renders title, body, and relative time', () => {
    const { getByText } = withTheme(
      <NotificationInboxRow
        inboxId="notif-1"
        kind="chat_message"
        title="New message from David"
        body="Are you still available?"
        time="5m"
        unread={true}
      />,
    );

    expect(getByText('New message from David')).toBeTruthy();
    expect(getByText('Are you still available?')).toBeTruthy();
    expect(getByText('5m')).toBeTruthy();
  });

  it('renders groupHint when provided', () => {
    const { getByText } = withTheme(
      <NotificationInboxRow
        inboxId="notif-1"
        kind="chat_message"
        title="Group update"
        body="Update details"
        time="10m"
        unread={false}
        groupHint="Volunteers Group"
      />,
    );

    expect(getByText('Volunteers Group')).toBeTruthy();
  });

  it('triggers onOpen with inboxId, data, and readAt on press', () => {
    const onOpen = vi.fn();
    const data = { postId: 'post-123' };

    const { getByRole } = withTheme(
      <NotificationInboxRow
        inboxId="notif-1"
        kind="post_comment"
        title="Comment"
        body="Nice post"
        time="1h"
        unread={true}
        data={data}
        readAt={null}
        onOpen={onOpen}
      />,
    );

    fireEvent.click(getByRole('button'));
    expect(onOpen).toHaveBeenCalledWith('notif-1', data, null);
  });

  it('falls back to onPress when onOpen is not provided', () => {
    const onPress = vi.fn();

    const { getByRole } = withTheme(
      <NotificationInboxRow
        inboxId="notif-1"
        kind="general"
        title="System Notice"
        body="Maintenance scheduled"
        time="2h"
        unread={false}
        onPress={onPress}
      />,
    );

    fireEvent.click(getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('re-renders cleanly when unread or title changes (memoization preserves updates)', () => {
    const { getByText, queryByText, rerender } = render(
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <NotificationInboxRow
          inboxId="notif-1"
          kind="general"
          title="Initial Title"
          body="Body text"
          time="1m"
          unread={true}
        />
      </ThemeProvider>,
    );

    expect(getByText('Initial Title')).toBeTruthy();

    rerender(
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <NotificationInboxRow
          inboxId="notif-1"
          kind="general"
          title="Updated Title"
          body="Body text"
          time="1m"
          unread={false}
        />
      </ThemeProvider>,
    );

    expect(queryByText('Initial Title')).toBeNull();
    expect(getByText('Updated Title')).toBeTruthy();
  });
});

import { describe, it, expect } from 'vitest';
import { rowToChat, rowToMessage } from '../rowMappers';

// We intentionally use `as any` to construct typed-DB row shapes without
// pulling the full Database generic. The mappers' only contract is
// snake_case column → camelCase field + null coalescing.
/* eslint-disable @typescript-eslint/no-explicit-any */

describe('rowToChat', () => {
  it('maps a fully-populated chat row', () => {
    const row = {
      chat_id: 'c_1',
      participant_a: 'u_a',
      participant_b: 'u_b',
      anchor_post_id: 'p_1',
      is_support_thread: false,
      last_message_at: '2026-05-15T12:00:00.000Z',
      created_at: '2026-05-10T08:00:00.000Z',
    } as any;

    expect(rowToChat(row)).toEqual({
      chatId: 'c_1',
      participantIds: ['u_a', 'u_b'],
      anchorPostId: 'p_1',
      anchorRideId: null,
      anchorListingId: null,
      isSupportThread: false,
      lastMessageAt: '2026-05-15T12:00:00.000Z',
      createdAt: '2026-05-10T08:00:00.000Z',
    });
  });

  it('maps the listing a chat was opened from (KC#1297)', () => {
    const row = {
      chat_id: 'c_3',
      participant_a: 'u_a',
      participant_b: 'u_b',
      anchor_post_id: null,
      anchor_ride_id: null,
      anchor_listing_id: 'l_1',
      is_support_thread: false,
      last_message_at: null,
      created_at: '2026-05-10T08:00:00.000Z',
    } as any;

    expect(rowToChat(row)).toMatchObject({ anchorPostId: null, anchorRideId: null, anchorListingId: 'l_1' });
  });

  it('keeps null participant slots after account deletion (migration 0028)', () => {
    const row = {
      chat_id: 'c_2',
      participant_a: null,
      participant_b: 'u_b',
      anchor_post_id: null,
      is_support_thread: false,
      last_message_at: null,
      created_at: '2026-05-10T08:00:00.000Z',
    } as any;

    const out = rowToChat(row);
    expect(out.participantIds).toEqual([null, 'u_b']);
    expect(out.anchorPostId).toBeNull();
    expect(out.lastMessageAt).toBeNull();
  });

  it('flags support threads via is_support_thread', () => {
    const row = {
      chat_id: 'c_support',
      participant_a: 'u_a',
      participant_b: 'admin',
      anchor_post_id: null,
      is_support_thread: true,
      last_message_at: '2026-05-12T00:00:00.000Z',
      created_at: '2026-05-12T00:00:00.000Z',
    } as any;

    expect(rowToChat(row).isSupportThread).toBe(true);
  });
});

describe('rowToMessage', () => {
  it('maps a fully-populated user message', () => {
    const row = {
      message_id: 'm_1',
      chat_id: 'c_1',
      sender_id: 'u_sender',
      kind: 'user',
      body: 'שלום',
      system_payload: null,
      status: 'delivered',
      created_at: '2026-05-15T12:00:00.000Z',
      delivered_at: '2026-05-15T12:00:01.000Z',
      read_at: '2026-05-15T12:00:10.000Z',
    } as any;

    expect(rowToMessage(row)).toEqual({
      messageId: 'm_1',
      chatId: 'c_1',
      senderId: 'u_sender',
      kind: 'user',
      body: 'שלום',
      systemPayload: null,
      mediaPayload: null,
      status: 'delivered',
      createdAt: '2026-05-15T12:00:00.000Z',
      deliveredAt: '2026-05-15T12:00:01.000Z',
      readAt: '2026-05-15T12:00:10.000Z',
    });
  });

  it('coalesces null body to empty string for system messages', () => {
    const row = {
      message_id: 'm_sys',
      chat_id: 'c_1',
      sender_id: null,
      kind: 'system',
      body: null,
      system_payload: { kind: 'closure', delivered: true },
      status: 'delivered',
      created_at: '2026-05-15T12:00:00.000Z',
      delivered_at: '2026-05-15T12:00:00.000Z',
      read_at: null,
    } as any;

    const out = rowToMessage(row);
    expect(out.body).toBe('');
    expect(out.senderId).toBeNull();
    expect(out.systemPayload).toEqual({ kind: 'closure', delivered: true });
  });

  it('preserves a non-null system_payload as a plain object', () => {
    const row = {
      message_id: 'm_payload',
      chat_id: 'c_1',
      sender_id: null,
      kind: 'system',
      body: null,
      system_payload: { reason: 'Spam', target_preview: { author_handle: 'who' } },
      status: 'delivered',
      created_at: '2026-05-15T12:00:00.000Z',
      delivered_at: '2026-05-15T12:00:00.000Z',
      read_at: null,
    } as any;

    const out = rowToMessage(row);
    expect(out.systemPayload).toEqual({
      reason: 'Spam',
      target_preview: { author_handle: 'who' },
    });
  });

  it('leaves delivered_at / read_at null for pending sends', () => {
    const row = {
      message_id: 'm_pending',
      chat_id: 'c_1',
      sender_id: 'u_sender',
      kind: 'user',
      body: 'in flight',
      system_payload: null,
      status: 'pending',
      created_at: '2026-05-15T12:00:00.000Z',
      delivered_at: null,
      read_at: null,
    } as any;

    const out = rowToMessage(row);
    expect(out.deliveredAt).toBeNull();
    expect(out.readAt).toBeNull();
    expect(out.status).toBe('pending');
  });
});

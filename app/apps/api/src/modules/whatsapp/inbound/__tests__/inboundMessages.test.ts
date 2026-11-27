import { describe, expect, it } from 'vitest';
import { handleDelivery, type InboundDeps, type InboundMessage, type ProPhoto } from '../inboundMessages';
import { keywordReply, upsellReply } from '../replies';

const WA_ID = '972500000001';
const textMessage = (body: string, id = 'wamid.1'): InboundMessage => ({ id, from: WA_ID, type: 'text', text: { body } });
const deliveryOf = (...messages: InboundMessage[]) => ({ entry: [{ changes: [{ value: { messages, metadata: { phone_number_id: 'pn-1' } } }] }] });

/** What each database function answers; a test overrides the ones it is about. */
type Answers = Partial<Record<string, unknown | (() => unknown)>>;

/**
 * The channel with a database double. By default: a new, unthrottled message
 * from an unlinked number that is not a keyword and is owed no upsell.
 */
function setup(answers: Answers = {}, hooks: Pick<InboundDeps, 'onProMessage' | 'onProPhoto'> = {}) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const defaults: Answers = {
    api_whatsapp_claim_inbound: true,
    api_whatsapp_release_inbound: null,
    api_whatsapp_inbound_allowed: true,
    api_whatsapp_ingest_inbound: 'record-1',
    api_whatsapp_handle_keyword: { action: null },
    api_whatsapp_redeem_link_code: { status: 'linked' },
    api_whatsapp_bot_access: { access: 'unlinked', user_id: null, upsell: false },
    api_whatsapp_queue_reply: 'reply-1',
  };
  const deps: InboundDeps = {
    ...hooks,
    rpc: (fn, args) => {
      calls.push({ fn, args });
      const answer = Object.hasOwn(answers, fn) ? answers[fn] : defaults[fn];
      // A function that answers with an Error is a database failure.
      const value = typeof answer === 'function' ? (answer as () => unknown)() : answer;
      return Promise.resolve(value instanceof Error ? { data: null, error: { message: value.message } } : { data: value, error: null });
    },
  };
  const called = (fn: string) => calls.filter((call) => call.fn === fn).map((call) => call.args);
  return { run: (...messages: InboundMessage[]) => handleDelivery(deps, deliveryOf(...messages)), calls, called };
}

describe('handleDelivery', () => {
  it('stores a new message with the delivery\'s metadata and asks every question in order', async () => {
    const { run, calls, called } = setup();

    const [outcome] = await run(textMessage('hello'));

    expect(outcome).toEqual({ message_id: 'wamid.1', record_id: 'record-1', access: 'unlinked' });
    expect(calls.map((call) => call.fn)).toEqual([
      'api_whatsapp_claim_inbound',
      'api_whatsapp_inbound_allowed',
      'api_whatsapp_ingest_inbound',
      'api_whatsapp_handle_keyword',
      'api_whatsapp_bot_access',
    ]);
    expect(called('api_whatsapp_ingest_inbound')).toEqual([{ p_message_id: 'wamid.1', p_payload: { message: textMessage('hello'), metadata: { phone_number_id: 'pn-1' } } }]);
  });

  it('skips a delivery the provider sent again: nothing is stored or answered twice', async () => {
    const { run, calls } = setup({ api_whatsapp_claim_inbound: false });

    expect(await run(textMessage('hello'))).toEqual([{ message_id: 'wamid.1', record_id: null, duplicate: true }]);
    expect(calls.map((call) => call.fn)).toEqual(['api_whatsapp_claim_inbound']);
  });

  it('skips a message without an id and handles the others of the delivery', async () => {
    const { run, called } = setup();

    const outcomes = await run({ from: WA_ID, type: 'text', text: { body: 'no id' } }, textMessage('second', 'wamid.2'));

    expect(outcomes.map((outcome) => outcome.message_id)).toEqual(['wamid.2']);
    expect(called('api_whatsapp_claim_inbound')).toEqual([{ p_message_id: 'wamid.2' }]);
  });

  it('answers a consent keyword with its confirmation, in the language the database detected', async () => {
    const { run, called } = setup({ api_whatsapp_handle_keyword: { action: 'opt_out', language: 'en' } });

    const [outcome] = await run(textMessage('STOP'));

    expect(outcome).toMatchObject({ keyword: 'opt_out', reply_id: 'reply-1' });
    expect(called('api_whatsapp_queue_reply')).toEqual([{ p_wa_id: WA_ID, p_body: keywordReply('opt_out', 'en'), p_reply_kind: 'consent_confirmation' }]);
    // A keyword is not a conversation: the bot gate is not asked.
    expect(called('api_whatsapp_bot_access')).toEqual([]);
  });

  it('does not store a throttled number\'s message, but still honours its consent keyword', async () => {
    const stop = setup({ api_whatsapp_inbound_allowed: false, api_whatsapp_handle_keyword: { action: 'opt_out', language: 'he' } });
    const chatter = setup({ api_whatsapp_inbound_allowed: false });

    const [stopped] = await stop.run(textMessage('הסר'));
    const [ignored] = await chatter.run(textMessage('hello again'));

    expect(stopped).toMatchObject({ throttled: true, record_id: null, keyword: 'opt_out' });
    expect(stop.called('api_whatsapp_ingest_inbound')).toEqual([]);
    expect(stop.called('api_whatsapp_handle_keyword')).toEqual([{ p_wa_id: WA_ID, p_text: 'הסר', p_record_id: null }]);
    expect(ignored).toEqual({ message_id: 'wamid.1', record_id: null, throttled: true });
    expect(chatter.called('api_whatsapp_bot_access')).toEqual([]);
  });

  it('redeems a link code and answers with the result, without asking the bot gate', async () => {
    const { run, called } = setup({ api_whatsapp_redeem_link_code: { status: 'invalid' } });

    const [outcome] = await run(textMessage('LINK 123456'));

    expect(outcome).toMatchObject({ link_status: 'invalid', reply_id: 'reply-1' });
    expect(called('api_whatsapp_redeem_link_code')).toEqual([{ p_wa_id: WA_ID, p_code: '123456' }]);
    expect(called('api_whatsapp_bot_access')).toEqual([]);
  });

  it('hands a linked Pro member\'s text to the agent with the stored record', async () => {
    const handed: unknown[] = [];
    const { run, called } = setup(
      { api_whatsapp_bot_access: { access: 'pro', user_id: 'user-1', upsell: false } },
      { onProMessage: (input) => Promise.resolve(void handed.push(input)) },
    );

    const [outcome] = await run(textMessage('looking for a sofa'));

    expect(outcome).toMatchObject({ access: 'pro' });
    expect(handed).toEqual([{ waId: WA_ID, userId: 'user-1', text: 'looking for a sofa', recordId: 'record-1' }]);
    expect(called('api_whatsapp_queue_reply')).toEqual([]);
  });

  it.each(['unlinked', 'not_pro'] as const)('sends the %s upsell only when the database says one is due', async (access) => {
    const due = setup({ api_whatsapp_bot_access: { access, user_id: null, upsell: true } });
    const notDue = setup({ api_whatsapp_bot_access: { access, user_id: null, upsell: false } });

    await due.run(textMessage('hello'));
    await notDue.run(textMessage('hello'));

    expect(due.called('api_whatsapp_queue_reply')).toEqual([{ p_wa_id: WA_ID, p_body: upsellReply(access, 'en'), p_reply_kind: 'reply' }]);
    expect(notDue.called('api_whatsapp_queue_reply')).toEqual([]);
  });

  it('stays silent for a number linked to a deactivated account: no agent and no upsell', async () => {
    const handed: unknown[] = [];
    const { run, called } = setup({ api_whatsapp_bot_access: { access: 'inactive', user_id: 'user-1', upsell: true } }, { onProMessage: (input) => Promise.resolve(void handed.push(input)) });

    expect((await run(textMessage('hello')))[0]).toMatchObject({ access: 'inactive' });
    expect([handed, called('api_whatsapp_queue_reply')]).toEqual([[], []]);
  });

  it('sends a Pro member\'s photo to the photo flow, never to the agent, and ignores one without a media id', async () => {
    const photos: ProPhoto[] = [];
    const texts: unknown[] = [];
    const hooks = { onProPhoto: (photo: ProPhoto) => Promise.resolve(void photos.push(photo)), onProMessage: (input: unknown) => Promise.resolve(void texts.push(input)) };
    const { run, called } = setup({ api_whatsapp_bot_access: { access: 'pro', user_id: 'user-1', upsell: false } }, hooks);

    await run(
      { id: 'wamid.p1', from: WA_ID, type: 'image', image: { id: 'media-9', mime_type: 'image/jpeg', caption: 'the sofa' } },
      { id: 'wamid.p2', from: WA_ID, type: 'image', image: {} },
    );

    expect(photos).toEqual([{ waId: WA_ID, userId: 'user-1', mediaId: 'media-9', mimeType: 'image/jpeg', caption: 'the sofa', recordId: 'record-1' }]);
    expect(texts).toEqual([]);
    // An image carries no keyword and no link code.
    expect(called('api_whatsapp_handle_keyword')).toEqual([]);
  });

  it('releases a message\'s claim when a later step fails, so the provider\'s retry is processed', async () => {
    const { run, called } = setup({ api_whatsapp_ingest_inbound: () => new Error('database unavailable') });

    await expect(run(textMessage('hello'))).rejects.toThrow('database unavailable');
    expect(called('api_whatsapp_release_inbound')).toEqual([{ p_message_id: 'wamid.1' }]);
  });

  it('fails without releasing anything when the claim itself cannot be made', async () => {
    const { run, called } = setup({ api_whatsapp_claim_inbound: () => new Error('database unavailable') });

    await expect(run(textMessage('hello'))).rejects.toThrow('database unavailable');
    expect(called('api_whatsapp_release_inbound')).toEqual([]);
  });
});

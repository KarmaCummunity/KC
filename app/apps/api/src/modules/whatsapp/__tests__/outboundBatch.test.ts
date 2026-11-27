import { expect, it } from 'vitest';
import type { OutboundMessage, SendResult } from '../metaClient';
import { type RpcFn, runSenderBatch, toOutboundMessage } from '../outboundBatch';

type Call = { fn: string; args: Record<string, unknown> };

function fakeRpc(rows: unknown[], calls: Call[]): RpcFn {
  return (fn, args) => {
    calls.push({ fn, args });
    if (fn === 'api_whatsapp_outbound_claim') return Promise.resolve({ data: rows, error: null });
    if (fn === 'api_whatsapp_outbound_result') {
      const status = args.p_ok ? 'sent' : args.p_retryable ? 'queued' : 'failed';
      return Promise.resolve({ data: status, error: null });
    }
    return Promise.resolve({ data: null, error: { message: `unexpected ${fn}` } });
  };
}

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  outbound_id: id, kind: 'session', to_wa_id: '972500000001', language: 'he',
  template_name: null, body: 'hello', payload: {}, ...extra,
});

it('runSenderBatch sends each claimed row and reports sent / retry / fail', async () => {
  const calls: Call[] = [];
  const sent: OutboundMessage[] = [];
  const results: SendResult[] = [
    { ok: true, waMessageId: 'wamid.1' },
    { ok: false, error: 'HTTP 429', retryable: true },
    { ok: false, error: 'HTTP 400 code 131047', retryable: false },
  ];
  const summary = await runSenderBatch({
    rpc: fakeRpc([row('a'), row('b'), row('c')], calls),
    send: (m) => { sent.push(m); return Promise.resolve(results[sent.length - 1] as SendResult); },
    batch: 5,
  });
  expect(summary).toEqual({ claimed: 3, sent: 1, retried: 1, failed: 1 });
  expect(calls[0]).toEqual({ fn: 'api_whatsapp_outbound_claim', args: { p_batch: 5, p_visibility_seconds: 60 } });
  const resultArgs = calls.filter((c) => c.fn === 'api_whatsapp_outbound_result').map((c) => c.args);
  expect(resultArgs[0]).toEqual({ p_outbound_id: 'a', p_ok: true, p_wa_message_id: 'wamid.1', p_error: null, p_retryable: false });
  expect(resultArgs[1]!.p_retryable).toEqual(true);
  expect(resultArgs[2]!.p_retryable).toEqual(false);
});

it('malformed rows are failed without calling Meta', async () => {
  const calls: Call[] = [];
  let sends = 0;
  const summary = await runSenderBatch({
    rpc: fakeRpc([row('x', { to_wa_id: null })], calls),
    send: () => { sends++; return Promise.resolve({ ok: true, waMessageId: null }); },
  });
  expect(sends).toEqual(0);
  expect(summary.failed).toEqual(1);
});

it('nothing claimed (caps exhausted) → no sends', async () => {
  let sends = 0;
  const summary = await runSenderBatch({
    rpc: fakeRpc([], []),
    send: () => { sends++; return Promise.resolve({ ok: true, waMessageId: null }); },
  });
  expect(summary).toEqual({ claimed: 0, sent: 0, retried: 0, failed: 0 });
  expect(sends).toEqual(0);
});

it('claim errors propagate', async () => {
  await expect(runSenderBatch({
    rpc: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
    send: () => Promise.resolve({ ok: true, waMessageId: null }),
  })).rejects.toThrow('claim failed: boom');
});

it('template rows resolve named params from the registry; missing params never send', () => {
  expect(toOutboundMessage(row('t', { kind: 'template', template_name: 'match_found_v1', language: 'en', payload: { world_label_en: 'Items' } }) as never)).toEqual({ kind: 'template', to: '972500000001', templateName: 'match_found_v1', language: 'en', params: ['Items'] });
  expect(toOutboundMessage(row('t', { kind: 'template', template_name: 'match_found_v1', payload: {} }) as never)).toEqual(null);
  expect(toOutboundMessage(row('t', { kind: 'template', template_name: 'intake_confirm_v1', payload: {} }) as never)).toEqual(null);
});

it('toOutboundMessage maps template rows with params', () => {
  expect(toOutboundMessage(row('t', { kind: 'template', template_name: 'match_found_v1', language: 'en', payload: { params: ['a', 2] } }) as never)).toEqual({ kind: 'template', to: '972500000001', templateName: 'match_found_v1', language: 'en', params: ['a', '2'] });
});

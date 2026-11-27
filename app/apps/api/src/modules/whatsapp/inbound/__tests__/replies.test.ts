import { describe, expect, it } from 'vitest';
import { isKeywordAction, keywordReply, replyKind } from '../replies';

describe('WhatsApp replies', () => {
  it('keyword replies exist in he and en and default to he', () => {
    for (const a of ['opt_out', 'opt_in', 'help'] as const) {
      expect(keywordReply(a, 'he')).not.toEqual(keywordReply(a, 'en'));
      expect(keywordReply(a, null)).toEqual(keywordReply(a, 'he'));
    }
    expect(keywordReply('opt_out', 'en').includes('START')).toEqual(true);
  });

  it('consent changes use the consent_confirmation reply kind', () => {
    expect(replyKind('opt_out')).toEqual('consent_confirmation');
    expect(replyKind('opt_in')).toEqual('consent_confirmation');
    expect(replyKind('help')).toEqual('help');
    expect(isKeywordAction('stop')).toEqual(false);
    expect(isKeywordAction(null)).toEqual(false);
  });
});

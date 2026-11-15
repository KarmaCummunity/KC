import { describe, expect, it } from 'vitest';
import { PostError } from '@kc/application';
import { BackendRuleError, BackendUnavailableError } from '@kc/domain';
import { toPostError } from '../postErrors';

describe('toPostError', () => {
  it.each([
    ['closure_wrong_status', 'closure_wrong_status'],
    ['closure_recipient_not_in_chat', 'closure_recipient_not_in_chat'],
    ['reopen_window_expired', 'reopen_window_expired'],
    ['listing_has_active_handoff', 'closure_wrong_status'],
    ['post_limit_exceeded', 'active_post_limit_exceeded'],
    ['post_not_found', 'not_found'],
    ['account_not_active', 'forbidden'],
    ['followers_only_requires_public_profile', 'invalid_visibility'],
  ])('maps the rule refusal %s to the code %s', (reason, code) => {
    const mapped = toPostError(new BackendRuleError(reason, 'rpc:x'));
    expect(mapped).toBeInstanceOf(PostError);
    expect((mapped as PostError).code).toBe(code);
  });

  it('maps an unknown refusal to the unknown code', () => {
    expect((toPostError(new BackendRuleError('brand_new_rule', 'rpc:x')) as PostError).code).toBe('unknown');
  });

  it('keeps a missing backend object as it is (the screen degrades on it)', () => {
    const unavailable = new BackendUnavailableError('rpc:publish_post', 'function');
    expect(toPostError(unavailable)).toBe(unavailable);
  });

  it('classifies a refused direct write by its constraint', () => {
    const wrap = (cause: object) => Object.assign(new Error('write failed'), { cause });
    expect((toPostError(wrap({ code: '23503', message: 'violates foreign key posts_city_id_fkey' })) as PostError).code).toBe('city_not_found');
    expect((toPostError(wrap({ code: '23514', message: 'violates check posts_title_check' })) as PostError).code).toBe('title_too_long');
    expect((toPostError(wrap({ code: '23514', message: 'violates check post_private_locations_street_number' })) as PostError).code).toBe('street_number_invalid');
    expect((toPostError(wrap({ code: '42501', message: 'row-level security' })) as PostError).code).toBe('forbidden');
  });

  it('returns an error it does not classify unchanged', () => {
    const other = new Error('network down');
    expect(toPostError(other)).toBe(other);
  });
});

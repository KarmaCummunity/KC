import { describe, expect, it } from 'vitest';
import { guestWriteVisibility, shouldPromptGuestSignIn } from '../guestWriteGate';

describe('guestWriteGate', () => {
  it('allows every write for a signed-in member', () => {
    expect(guestWriteVisibility(true, 'hide')).toBe('allow');
    expect(guestWriteVisibility(true, 'prompt')).toBe('allow');
    expect(shouldPromptGuestSignIn(true)).toBe(false);
  });

  it('hides or prompts for a guest — never allows the write', () => {
    expect(guestWriteVisibility(false, 'hide')).toBe('hide');
    expect(guestWriteVisibility(false, 'prompt')).toBe('prompt');
    expect(guestWriteVisibility(false)).toBe('prompt');
    expect(shouldPromptGuestSignIn(false)).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import {
  ContractViolation,
  assertTrue,
  assertEqual,
  assertSameList,
  assertDefined,
  assertRejects,
  assertRejectsWithCode,
} from '../assert';

describe('assert contracts', () => {
  describe('ContractViolation', () => {
    it('constructs an Error with name ContractViolation', () => {
      const err = new ContractViolation('test message');
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('ContractViolation');
      expect(err.message).toBe('test message');
    });
  });

  describe('assertTrue', () => {
    it('does nothing when true', () => {
      expect(() => assertTrue(true, 'should be true')).not.toThrow();
    });

    it('throws ContractViolation when false', () => {
      expect(() => assertTrue(false, 'condition failed')).toThrow(ContractViolation);
    });
  });

  describe('assertEqual', () => {
    it('passes when values match by identity', () => {
      expect(() => assertEqual(42, 42, 'numbers')).not.toThrow();
      expect(() => assertEqual('hello', 'hello', 'strings')).not.toThrow();
    });

    it('throws ContractViolation with formatted values on mismatch', () => {
      expect(() => assertEqual(1, 2, 'number mismatch')).toThrow(ContractViolation);
      expect(() => assertEqual({ a: 1 }, { a: 1 }, 'object identity')).toThrow(ContractViolation);
    });
  });

  describe('assertSameList', () => {
    it('passes when arrays have identical elements in same order', () => {
      expect(() => assertSameList(['a', 'b'], ['a', 'b'], 'lists')).not.toThrow();
      expect(() => assertSameList([], [], 'empty lists')).not.toThrow();
    });

    it('throws when lengths differ', () => {
      expect(() => assertSameList(['a'], ['a', 'b'], 'length mismatch')).toThrow(ContractViolation);
    });

    it('throws when elements differ', () => {
      expect(() => assertSameList(['a', 'b'], ['a', 'c'], 'element mismatch')).toThrow(ContractViolation);
    });
  });

  describe('assertDefined', () => {
    it('passes for defined values', () => {
      expect(() => assertDefined(0, 'zero')).not.toThrow();
      expect(() => assertDefined('', 'empty string')).not.toThrow();
      expect(() => assertDefined(false, 'boolean false')).not.toThrow();
    });

    it('throws for null or undefined', () => {
      expect(() => assertDefined(null, 'null value')).toThrow(ContractViolation);
      expect(() => assertDefined(undefined, 'undefined value')).toThrow(ContractViolation);
    });
  });

  describe('assertRejects', () => {
    it('resolves when the promise rejects', async () => {
      await expect(assertRejects(Promise.reject(new Error('fail')), 'rejected')).resolves.toBeUndefined();
    });

    it('throws ContractViolation when promise resolves', async () => {
      await expect(assertRejects(Promise.resolve('ok'), 'resolved')).rejects.toThrow(ContractViolation);
    });
  });

  describe('assertRejectsWithCode', () => {
    it('resolves when error carries matching code', async () => {
      const err = Object.assign(new Error('custom'), { code: 'ERR_TEST' });
      await expect(
        assertRejectsWithCode(Promise.reject(err), 'ERR_TEST', 'matching code'),
      ).resolves.toBeUndefined();
    });

    it('throws ContractViolation when promise resolves instead of rejecting', async () => {
      await expect(
        assertRejectsWithCode(Promise.resolve('ok'), 'ERR_TEST', 'resolves'),
      ).rejects.toThrow(ContractViolation);
    });

    it('throws ContractViolation when error carries different code or no code', async () => {
      const errDifferent = Object.assign(new Error('other'), { code: 'OTHER' });
      await expect(
        assertRejectsWithCode(Promise.reject(errDifferent), 'EXPECTED', 'wrong code'),
      ).rejects.toThrow(ContractViolation);

      await expect(
        assertRejectsWithCode(Promise.reject(new Error('raw')), 'EXPECTED', 'missing code'),
      ).rejects.toThrow(ContractViolation);
    });
  });

  describe('show formatting edge cases', () => {
    it('handles Error instances in show()', () => {
      const customErr = new TypeError('invalid type');
      expect(() => assertEqual(customErr as unknown, 'other', 'error show')).toThrow('TypeError: invalid type');
    });

    it('handles circular references in show()', () => {
      const circular: Record<string, unknown> = {};
      circular['self'] = circular;
      expect(() => assertEqual(circular as unknown, 'other', 'circular show')).toThrow('[object Object]');
    });
  });
});

import { BadGatewayException, ForbiddenException, GoneException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../ApiError';
import { describeError } from '../describeError';

describe('describeError', () => {
  it('keeps the status and code of an ApiError', () => {
    expect(describeError(new ApiError('post_not_found', 404))).toEqual({ status: 404, code: 'post_not_found' });
  });

  it('names the common framework failures', () => {
    expect(describeError(new NotFoundException())).toEqual({ status: 404, code: 'not_found' });
    expect(describeError(new ForbiddenException())).toEqual({ status: 403, code: 'forbidden' });
  });

  it('keeps the status of an unnamed client failure under a generic code', () => {
    expect(describeError(new GoneException())).toEqual({ status: 410, code: 'request_error' });
  });

  it('hides every server-side failure behind internal_error', () => {
    const internal = { status: 500, code: 'internal_error' };

    expect(describeError(new BadGatewayException('upstream host name'))).toEqual(internal);
    expect(describeError(new Error('connection string'))).toEqual(internal);
    expect(describeError('a thrown string')).toEqual(internal);
    expect(describeError(undefined)).toEqual(internal);
  });
});

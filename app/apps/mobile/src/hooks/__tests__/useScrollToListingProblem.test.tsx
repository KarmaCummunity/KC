// @vitest-environment jsdom
// FR-POST-001 AC6 — listing form scrolls to the invalid field after publish is blocked.
import React from 'react';
import { act, render } from '@testing-library/react';
import { ScrollView, View } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useScrollToListingProblem } from '../useScrollToListingProblem';
import type { ListingFormField, ListingFormProblem } from '../../lib/unifiedCreate/listingFormProblem';

vi.mock('../listingScrollToField', () => ({
  scheduleScrollToListingField: vi.fn(() => () => {}),
}));

import { scheduleScrollToListingField } from '../listingScrollToField';

function Harness({ problem, field }: { problem: ListingFormProblem | null; field: ListingFormField | null }) {
  const { scrollRef, contentRef, register } = useScrollToListingProblem(problem, field);
  return (
    <ScrollView ref={scrollRef}>
      <View ref={contentRef}>
        <View ref={(n) => register('title', n)} />
      </View>
    </ScrollView>
  );
}

afterEach(() => {
  vi.mocked(scheduleScrollToListingField).mockClear();
});

describe('useScrollToListingProblem', () => {
  it('schedules a scroll when a field problem is set', async () => {
    const problem: ListingFormProblem = { message: 'm', field: 'title' };
    render(<Harness problem={problem} field="title" />);
    await act(async () => {});
    expect(scheduleScrollToListingField).toHaveBeenCalledTimes(1);
  });
});

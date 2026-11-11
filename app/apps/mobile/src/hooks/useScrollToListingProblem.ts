// Mapped to spec: FR-POST-001 AC6 — a failed publish scrolls the listing form to the field with
// the problem (measured against the scroll content, however deep the field sits); a problem with
// no field on screen scrolls to the message above Publish.
import { useCallback, useEffect, useRef } from 'react';
import { Keyboard, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView, type View } from 'react-native';
import type { ListingFormField, ListingFormProblem } from '../lib/unifiedCreate/listingFormProblem';
import { scheduleScrollToListingField } from './listingScrollToField';

export function useScrollToListingProblem(problem: ListingFormProblem | null, inlineField: ListingFormField | null) {
  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  const scrollY = useRef(0);
  const nodes = useRef(new Map<ListingFormField, View>());

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = event.nativeEvent.contentOffset.y;
  }, []);

  const register = useCallback((field: ListingFormField, node: View | null) => {
    if (node) nodes.current.set(field, node);
    else nodes.current.delete(field);
  }, []);

  useEffect(() => {
    if (!problem) return;
    const scroll = scrollRef.current;
    const content = contentRef.current;
    if (!scroll || !content) return;

    const node = inlineField ? nodes.current.get(inlineField) : undefined;
    Keyboard.dismiss();

    return scheduleScrollToListingField({
      scroll,
      content,
      node,
      scrollY: scrollY.current,
    });
  }, [problem, inlineField]);

  return { scrollRef, contentRef, register, onScroll };
}

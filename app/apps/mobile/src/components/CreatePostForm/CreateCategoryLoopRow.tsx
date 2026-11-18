// Mapped to spec: FR-POST-001 AC1 — the category row at the top of the create form scrolls in a
// circle: past the last giving world comes the first again, in both directions.
//
// The row holds three identical copies of the chips and is kept on the middle one: once the member
// has scrolled the middle copy fully out of view, the offset jumps by exactly one copy (plus the gap)
// without animation.
// The content is periodic, so the jump cannot be seen. Only the middle copy is visible to screen
// readers and carries test ids; when every chip fits on screen there is nothing to loop and the row
// is a single copy.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing } from '@kc/ui';
import { Chip } from '../ui/Chip';
import type { CreateCategoryConfig, CreateCategoryId } from '../../lib/unifiedCreate/createCategories';
import { loopedOffset } from '../../lib/loopedOffset';

/** Copies of the chips in a looping row; the member is kept on the middle one. */
const COPIES = 3;
const MIDDLE = 1;
/** Quiet time after the last scroll event before the offset is moved back to the middle copy. */
export const LOOP_SETTLE_MS = 120;

interface Box {
  readonly x: number;
  readonly width: number;
}

interface Props {
  readonly categories: readonly CreateCategoryConfig[];
  readonly categoryId: CreateCategoryId;
  readonly onCategoryChange: (id: CreateCategoryId) => void;
}

export function CreateCategoryLoopRow({ categories, categoryId, onCategoryChange }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  const scrollRef = useRef<ScrollView>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [copyWidth, setCopyWidth] = useState(0);
  const copyBoxes = useRef<Box[]>([]);
  const chipBoxes = useRef<Record<string, Box>>({});
  const offset = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The copy whose chip was just tapped, so the row centres that one instead of jumping. */
  const tappedCopy = useRef(MIDDLE);
  // Loop only when the chips do not all fit: otherwise one copy shows everything.
  const looping = viewportWidth > 0 && copyWidth > viewportWidth;
  const copies = looping ? COPIES : 1;
  const centreCopy = looping ? MIDDLE : 0;

  /** Scrolls so the chip of `id` in copy `copy` sits in the middle of the row. */
  const centerChip = useCallback(
    (id: string, copy: number, animated: boolean) => {
      const chip = chipBoxes.current[id];
      const copyBox = copyBoxes.current[copy];
      if (!chip || !copyBox || viewportWidth === 0) return;
      scrollRef.current?.scrollTo({ x: Math.max(copyBox.x + chip.x + chip.width / 2 - viewportWidth / 2, 0), animated });
    },
    [viewportWidth],
  );

  useEffect(() => {
    centerChip(categoryId, looping ? tappedCopy.current : 0, true);
    tappedCopy.current = MIDDLE;
  }, [categoryId, centerChip, looping]);

  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.x;
    if (!looping) return;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const [first, middle] = [copyBoxes.current[0], copyBoxes.current[MIDDLE]];
      if (!first || !middle) return;
      // Measured, not assumed: covers the gap between copies and a right-to-left layout alike.
      const next = loopedOffset(offset.current, middle.x, Math.abs(middle.x - first.x), viewportWidth);
      if (next !== offset.current) scrollRef.current?.scrollTo({ x: next, animated: false });
    }, LOOP_SETTLE_MS);
  };

  const onCopyLayout = (copy: number) => (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    copyBoxes.current[copy] = { x, width };
    if (copy === 0) setCopyWidth(width);
    // First layout: show the chosen chip in the middle copy without an animation.
    if (copy === centreCopy) centerChip(categoryId, centreCopy, false);
  };

  return (
    // testID: Maestro swipes this row to reach chips beyond the screen edge (flow 13).
    <ScrollView
      ref={scrollRef}
      testID="create-category-row"
      horizontal
      showsHorizontalScrollIndicator={false}
      onLayout={(e) => setViewportWidth(e.nativeEvent.layout.width)}
      onScroll={onScroll}
      scrollEventThrottle={16}
      contentContainerStyle={styles.row}
    >
      {Array.from({ length: copies }, (_, copy) => {
        const isCentre = copy === centreCopy;
        return (
          <View
            key={copy}
            style={styles.row}
            onLayout={onCopyLayout(copy)}
            // The side copies repeat the middle one: hidden from screen readers so each world is read once.
            importantForAccessibility={isCentre ? 'auto' : 'no-hide-descendants'}
            accessibilityElementsHidden={!isCentre}
            aria-hidden={!isCentre}
          >
            {categories.map((c) => (
              <View
                key={c.id}
                onLayout={isCentre ? (e) => {
                  const { x, width } = e.nativeEvent.layout;
                  chipBoxes.current[c.id] = { x, width };
                } : undefined}
              >
                <Chip
                  testID={isCentre ? `create-category-${c.id}` : undefined}
                  icon={c.icon}
                  label={t(c.labelKey)}
                  selected={c.id === categoryId}
                  onPress={() => {
                    tappedCopy.current = copy;
                    if (c.id === categoryId) centerChip(c.id, copy, true);
                    else onCategoryChange(c.id);
                  }}
                />
              </View>
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}

const useStyles = makeUseStyles(() => ({
  // Plain `row`: native mirrors it under forceRTL, so the first chip sits at the reading-start edge.
  row: { flexDirection: 'row' as const, gap: spacing.xs },
}));

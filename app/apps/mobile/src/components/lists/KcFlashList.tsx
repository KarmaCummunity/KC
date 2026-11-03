/**
 * Virtualized list wrapper — #896. Backed by React Native FlatList on every platform.
 * FlashList v1 was removed: it mis-measured cells under the New Architecture and its
 * Android native module no longer compiles against React Native 0.81.
 * `estimatedItemSize` is still accepted (and ignored) so call sites stay unchanged.
 */
import React, { forwardRef } from 'react';
import { FlatList, type FlatListProps, type ViewStyle } from 'react-native';

export type ListRenderItem<T> = NonNullable<FlatListProps<T>['renderItem']>;
export type ListRenderItemInfo<T> = Parameters<ListRenderItem<T>>[0];
export type KcFlashListRef<T> = FlatList<T>;

export type KcFlashListProps<T> = Omit<FlatListProps<T>, 'contentContainerStyle'> & {
  estimatedItemSize?: number;
  contentContainerStyle?: ViewStyle | Array<ViewStyle | false | null | undefined>;
};

function KcFlashListInner<T>(props: KcFlashListProps<T>, ref: React.Ref<FlatList<T>>) {
  const { estimatedItemSize: _ignored, contentContainerStyle, ...rest } = props;
  return (
    <FlatList
      ref={ref}
      {...rest}
      contentContainerStyle={contentContainerStyle as ViewStyle}
      windowSize={rest.windowSize ?? 11}
      removeClippedSubviews={rest.removeClippedSubviews ?? false}
    />
  );
}

export const KcFlashList = forwardRef(KcFlashListInner) as <T>(
  props: KcFlashListProps<T> & { ref?: React.Ref<FlatList<T>> },
) => React.ReactElement;

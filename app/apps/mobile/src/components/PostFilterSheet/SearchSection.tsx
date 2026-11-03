// Mapped to spec: FR-FEED-003 / FR-FEED-004 (search input inside PostFilterSheet)
import React, { useEffect, useRef, useState } from 'react';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { FilterSearchBar } from '../filterKit/FilterSearchBar';

const DEBOUNCE_MS = 300;

interface SearchSectionProps {
  searchQuery: string;
  sheetVisible: boolean;
  onSearchQueryChange: (q: string) => void;
}

export function SearchSection({
  searchQuery,
  sheetVisible,
  onSearchQueryChange,
}: SearchSectionProps) {
  const [inputText, setInputText] = useState(searchQuery);
  const debounced = useDebouncedValue(inputText, DEBOUNCE_MS);
  const onChangeRef = useRef(onSearchQueryChange);
  onChangeRef.current = onSearchQueryChange;
  const wasVisibleRef = useRef(false);

  // Seed local input once when the sheet opens (not on every store-driven searchQuery tick).
  useEffect(() => {
    if (sheetVisible && !wasVisibleRef.current) {
      setInputText(searchQuery);
    }
    wasVisibleRef.current = sheetVisible;
  }, [sheetVisible, searchQuery]);

  useEffect(() => {
    if (!sheetVisible) return;
    const next = debounced.trim();
    if (next === searchQuery) return;
    onChangeRef.current(next);
  }, [debounced, sheetVisible, searchQuery]);

  return (
    <FilterSearchBar
      value={inputText}
      onChangeText={setInputText}
    />
  );
}

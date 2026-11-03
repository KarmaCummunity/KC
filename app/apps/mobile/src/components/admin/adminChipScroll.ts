import { StyleSheet } from 'react-native';

// A horizontal ScrollView inside a flex column stretches to fill the remaining
// height on iOS, turning filter chips into tall boxes. Pin it to content height.
export const adminChipScroll = StyleSheet.create({
  scroll:  { flexGrow: 0, flexShrink: 0 },
  content: { alignItems: 'center' },
});

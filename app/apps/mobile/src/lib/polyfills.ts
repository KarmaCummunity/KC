// WHATWG URL polyfill for native. React Native's built-in URL is partial
// (read-only `protocol`, incomplete `searchParams`), which breaks supabase-js
// (realtime channel URLs, PostgREST query builders) on iOS/Android.
// Web keeps the browser's native URL.
import { Platform } from 'react-native';

if (Platform.OS !== 'web') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setupURLPolyfill } = require('react-native-url-polyfill');
  setupURLPolyfill();
}

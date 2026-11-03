// The app ships as a web export, so `tsc` must see Expo's react-native-web
// types in CI exactly as it does on a machine that ran `expo start` (which
// writes the gitignored expo-env.d.ts). Before src/types/expo-web.d.ts existed,
// CI typechecked without them and a component that dropped `hovered` passed CI
// but failed every local typecheck.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PressableStateCallbackType } from 'react-native';

describe('Expo web types in typecheck', () => {
  it('types the web Pressable state (compile-time: tsc fails without the web types)', () => {
    const state: PressableStateCallbackType = { pressed: false, hovered: true };
    expect(state.hovered).toBe(true);
  });

  it('references expo/types from a committed declaration, not only the gitignored expo-env.d.ts', () => {
    const declaration = readFileSync(join(__dirname, '..', 'expo-web.d.ts'), 'utf8');
    expect(declaration).toContain('/// <reference types="expo/types" />');
  });
});

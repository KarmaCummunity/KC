import { vi } from 'vitest';

vi.mock('@react-navigation/elements', () => ({
  useHeaderHeight: () => 44,
}));

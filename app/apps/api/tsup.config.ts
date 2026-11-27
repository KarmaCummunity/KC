import { defineConfig } from 'tsup';

// Production build: one ESM file for Node. Workspace packages (`@kc/*`) ship
// as TypeScript source, so they are bundled in; npm dependencies stay external
// and are installed in the runtime image.
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  noExternal: [/^@kc\//],
});

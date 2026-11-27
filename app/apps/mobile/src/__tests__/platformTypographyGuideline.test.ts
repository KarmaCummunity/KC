import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, it } from 'vitest';
const guideline = readFileSync(new URL('../../../../../docs/spec/17_brand_and_design_system.md', import.meta.url), 'utf8');
describe('native platform typography guideline (#858)', () => {
  it('names typography in the platform table and points to the shared existing implementation', () => {
    const table = guideline.split('#### 4.4.1 Platform conventions (#858)')[1]?.split('**Haptics policy.**')[0] ?? '';
    const row = table.split('\n').find((line) => line.startsWith('| Typography |'));
    expect(row).toBeDefined();
    expect(row).toContain('Rubik');
    expect(row).toContain('TextInput');
    expect(row).toContain('typography.ts');
    expect(row).toContain('BrandText.tsx');
  });
});

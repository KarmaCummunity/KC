import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MOBILE_ROOT } from './guardKit/ratchet';

// FR-RESP-006 AC25 — every form gets keyboard Next / Previous / Done and the jump to the first
// problem field from the shared form kit. A screen that holds text fields must scroll through
// `FormScrollView` / `FormScreen` / `Screen scroll` / `BottomSheet` (which mount the form scope),
// never a bare `ScrollView`, or its fields silently miss the behaviour.

const SCANNED_DIRS = ['src', 'app'] as const;
const FIELD = /<(TextField|AnimatedAuthInput)\b/;
// A JSX tag (not a generic such as useRef<ScrollView>) that is not a horizontal scroller.
const BARE_VERTICAL_SCROLLVIEW = /(?<!\w)<ScrollView\b(?![^>]*\bhorizontal\b)/;
/** Mounts its own `FormScope` around a bare ScrollView because it needs that ScrollView's ref. */
const OWN_SCOPE = /<FormScope>/;

/** A lone search box above a results list: the ScrollView is a list, not a form. */
const NOT_A_FORM = new Set(['src/components/closure/ClosureRecipientPanes.tsx']);

function listSources(relativeDir: string): string[] {
  return readdirSync(path.join(MOBILE_ROOT, relativeDir), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : listSources(relativePath);
    return /\.tsx$/.test(entry.name) ? [relativePath] : [];
  });
}

describe('form scope coverage', () => {
  it('no screen with text fields scrolls through a bare ScrollView', () => {
    const offenders = SCANNED_DIRS.flatMap(listSources).filter((file) => {
      if (file.startsWith('src/components/ui/') || NOT_A_FORM.has(file)) return false;
      const source = readFileSync(path.join(MOBILE_ROOT, file), 'utf8');
      return FIELD.test(source) && BARE_VERTICAL_SCROLLVIEW.test(source) && !OWN_SCOPE.test(source);
    });
    expect(offenders, 'use FormScrollView (or wrap the ScrollView in <FormScope>) so the fields join the form scope').toEqual([]);
  });

  // The create / edit form folders hold only forms, so even a file whose fields live in a child
  // component (the link form) must not scroll through a bare vertical ScrollView.
  it('no create or edit form folder scrolls through a bare ScrollView', () => {
    const FORM_DIRS = ['src/components/CreatePostForm/', 'src/components/post/', 'src/components/challenges/'];
    const offenders = SCANNED_DIRS.flatMap(listSources).filter((file) => {
      if (!FORM_DIRS.some((dir) => file.startsWith(dir))) return false;
      const source = readFileSync(path.join(MOBILE_ROOT, file), 'utf8');
      return BARE_VERTICAL_SCROLLVIEW.test(source) && !OWN_SCOPE.test(source);
    });
    expect(offenders, 'use FormScrollView so the form gets the form scope').toEqual([]);
  });

  it('the manual per-form focus wiring is gone', () => {
    const offenders = SCANNED_DIRS.flatMap(listSources).filter((file) =>
      /useFormFieldFocus|bindField\(/.test(readFileSync(path.join(MOBILE_ROOT, file), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});

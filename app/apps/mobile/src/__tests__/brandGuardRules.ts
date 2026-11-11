// Brand guard rules — spec 17 §4/§4.1/§4.2/§6 (D65, D67, D87), debt TD-199.
//
// The patterns the guard counts in app code, and `countLiterals`, which applies
// them to one source file. `brandGuard.test.ts` runs them over the whole app;
// `brandGuardRules.test.ts` pins each rule's behaviour.

/** A line ending in `brand-guard-allow: <reason>` is skipped (reviewed in the PR). */
export const ALLOW_MARKER = 'brand-guard-allow:';

/** The mobile UI kit: shared components here may wrap raw primitives (TextInput, Modal) and define `Chip`. */
export const KIT_DIR = 'src/components/ui/';

/** Rules matched line by line; every match on a non-allowed line counts once. */
const LINE_RULES = {
  // `colors.*` from useTheme() / makeUseStyles().
  colorLiteral: /['"`](?:#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})['"`]|rgba?\()/g,
  // `typography.<preset>` for size, `typography.<modifier>` (medium…extraBold) for weight.
  fontSizeLiteral: /\bfontSize:\s*\d/g,
  fontWeightLiteral: /\bfontWeight:\s*['"`\d]/g,
  fontFamilyLiteral: /\bfontFamily:\s*['"`]/g,
  // `radius.*` — zero (square corner) is not a literal to replace.
  radiusLiteral: /\bborder(?:Top|Bottom)?(?:Start|End|Left|Right)?Radius:\s*[1-9]/g,
  // `spacing.*` for margin / padding / gap — zero is allowed.
  spacingLiteral:
    /\b(?:margin|padding)(?:Top|Bottom|Start|End|Left|Right|Horizontal|Vertical)?:\s*-?[1-9]|\b(?:gap|rowGap|columnGap):\s*[1-9]/g,
  // Physical sides break the RTL/LTR mirror: use start/end or the rtlLayout helpers.
  // Covers the style key and the `TextInput` prop form (`textAlign="right"`).
  physicalSide:
    /\btextAlign(?::\s*|=)['"`](?:left|right)['"`]|\b(?:margin|padding|border)(?:Left|Right)\w*:|\bborder(?:Top|Bottom)(?:Left|Right)Radius:/g,
  // `zIndex.*` layers — zero (the document flow) is allowed.
  zIndexLiteral: /\bzIndex:\s*-?[1-9]/g,
  // `shadow.*` presets. One count per property whose value holds a non-zero
  // number (`isDark ? 0 : 0.06` counts, `isDark ? 0 : shadow.card.elevation`
  // and a plain `0` that switches the shadow off do not); an offset counts
  // when either axis is non-zero.
  shadowLiteral:
    /\b(?:shadowOpacity|shadowRadius|elevation):[^,}\n]*?(?<![\w.])(?:[1-9]\d*(?:\.\d+)?|0?\.\d*[1-9]\d*)(?![\w.])|\bshadowOffset:\s*\{[^}]*?(?<![\w.])-?[1-9]/g,
  // Spec 17 §4.1: form fields use the kit `TextField`; a non-form input (chat
  // composer, search bar) carries the allow-marker with its reason.
  rawTextInput: /<TextInput\b/g,
  // Spec 17 §4.1: chips use the kit `Chip`. Counts the base style of a
  // hand-rolled chip — a style key named exactly `chip` holding an object
  // (`chip: {`). Variants (`chipActive`), containers (`chips`, `chipRow`) and
  // locale keys never match; a `pill` is not counted because the name also
  // covers nav tabs and separators.
  adHocChip: /(?:^|[{,])\s*['"]?chip['"]?\s*:\s*\{/g,
  // Spec 17 §4.4.2 (KC#1960): platform-specific values must use `platformSelect`
  // from `@kc/ui`. Raw `Platform.OS` or `Platform.select` branches are counted.
  rawPlatformCheck: /\bPlatform\.(?:OS|select)\b/g,
} as const;

/** Rules that do not apply inside the UI kit, which is where the shared wrappers live. */
const KIT_EXEMPT_RULES: ReadonlySet<string> = new Set(['rawTextInput', 'adHocChip']);

type LineRuleName = keyof typeof LINE_RULES;
export type RuleName = LineRuleName | 'rawModal' | 'iconSizeLiteral' | 'unmirroredDirectionalIcon';
export type FileCounts = Partial<Record<RuleName, number>>;

const LINE_RULE_NAMES = Object.keys(LINE_RULES) as LineRuleName[];
export const RULE_NAMES: readonly RuleName[] = [...LINE_RULE_NAMES, 'rawModal', 'iconSizeLiteral', 'unmirroredDirectionalIcon'];

// `import { …, Modal [as Alias], … } from 'react-native'` (named imports may span lines).
const RN_NAMED_IMPORTS = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]react-native['"]/g;
const RN_MODAL_SPECIFIER = /^Modal(?:\s+as\s+(\w+))?$/;

/** Local names under which a file imports React Native's `Modal` (usually just `Modal`). */
function reactNativeModalNames(source: string): string[] {
  return [...source.matchAll(RN_NAMED_IMPORTS)].flatMap((block) =>
    block[1].split(',').flatMap((specifier) => {
      const match = RN_MODAL_SPECIFIER.exec(specifier.trim());
      return match ? [match[1] ?? 'Modal'] : [];
    }),
  );
}

/**
 * `rawModal` (spec 17 §4.1): JSX uses of React Native's own `Modal` — the kit
 * `Modal` / `BottomSheet` wrap it. Only a file that imports `Modal` from
 * 'react-native' can match, so `<Modal` of the kit component is never counted.
 */
function countRawModals(checkedLines: readonly string[], source: string): number {
  return reactNativeModalNames(source).reduce(
    (sum, name) => sum + countMatches(checkedLines, new RegExp(`<${name}\\b`, 'g')),
    0,
  );
}

// An Ionicons size expression `size={…}` (no nested braces) …
const SIZE_PROP = /\bsize=\{([^{}]*)\}/;
// … holding a bare numeric literal, not a token such as `iconSize.md`.
const NUMERIC_LITERAL = /(?<![\w.])\d+(?:\.\d+)?(?![\w.])/;

/**
 * Index just past the `>` that closes the JSX opening tag starting at `from`.
 * `>` inside `{…}` attribute expressions (e.g. an arrow function) is skipped.
 */
function tagEnd(source: string, from: number): number {
  let depth = 0;
  for (let index = from; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (char === '>' && depth === 0) return index + 1;
  }
  return source.length;
}

/**
 * `iconSizeLiteral` (spec 17 §4.2): `<Ionicons … size={…}>` whose size holds a
 * numeric literal instead of `iconSize.*`. The tag may span lines; the
 * allow-marker belongs on the line that holds `size=`.
 */
function countIconSizeLiterals(source: string, lines: readonly string[]): number {
  let found = 0;
  for (const tag of source.matchAll(/<Ionicons\b/g)) {
    const start = tag.index;
    const size = SIZE_PROP.exec(source.slice(start, tagEnd(source, start)));
    if (!size || !NUMERIC_LITERAL.test(size[1])) continue;
    const sizeLine = source.slice(0, start + size.index).split('\n').length - 1;
    if (!lines[sizeLine].includes(ALLOW_MARKER)) found += 1;
  }
  return found;
}

// `name="chevron-back"` / `name={'arrow-forward'}` … on an Ionicons tag.
const NAME_PROP = /\bname=\{?\s*['"]([a-z0-9-]+)['"]\s*\}?/;
// Glyphs that point along the reading direction and so must flip in RTL (spec 17 §4.2).
const DIRECTIONAL_GLYPH = /^(?:arrow|chevron|caret|play|return|play-skip)-(?:back|forward)(?:-circle)?(?:-outline|-sharp)?$/;

/**
 * `unmirroredDirectionalIcon` (spec 17 §4.2, FR-RESP-006 AC18): `<Ionicons … name="…">`
 * whose glyph is directional. Such a glyph renders through the kit `MirroredIcon`
 * (which flips it in RTL) or `useDirectionalBackIcon()`; the allow-marker belongs
 * on the line that holds `name=`.
 */
function countUnmirroredDirectionalIcons(source: string, lines: readonly string[]): number {
  let found = 0;
  for (const tag of source.matchAll(/<Ionicons\b/g)) {
    const start = tag.index;
    const name = NAME_PROP.exec(source.slice(start, tagEnd(source, start)));
    if (!name || !DIRECTIONAL_GLYPH.test(name[1])) continue;
    const nameLine = source.slice(0, start + name.index).split('\n').length - 1;
    if (!lines[nameLine].includes(ALLOW_MARKER)) found += 1;
  }
  return found;
}

/** Matches of `pattern` across `lines`. */
function countMatches(lines: readonly string[], pattern: RegExp): number {
  return lines.reduce((sum, line) => sum + (line.match(pattern)?.length ?? 0), 0);
}

/**
 * Findings per rule in one source file. `file` is the mobile-relative path; it
 * decides whether the kit-only exemptions apply. Rules with no finding are omitted.
 */
export function countLiterals(source: string, file = ''): FileCounts {
  const lines = source.split('\n');
  const checkedLines = lines.filter((line) => !line.includes(ALLOW_MARKER));
  const inKit = file.startsWith(KIT_DIR);
  const counts: FileCounts = {};
  for (const rule of LINE_RULE_NAMES) {
    if (inKit && KIT_EXEMPT_RULES.has(rule)) continue;
    const found = countMatches(checkedLines, LINE_RULES[rule]);
    if (found > 0) counts[rule] = found;
  }
  // Kit-exempt like the line rules above. Counted before the icon sizes so the
  // baseline keeps its key order (rawModal used to be a line rule).
  const rawModals = inKit ? 0 : countRawModals(checkedLines, source);
  if (rawModals > 0) counts.rawModal = rawModals;
  const iconSizes = countIconSizeLiterals(source, lines);
  if (iconSizes > 0) counts.iconSizeLiteral = iconSizes;
  const unmirrored = countUnmirroredDirectionalIcons(source, lines);
  if (unmirrored > 0) counts.unmirroredDirectionalIcon = unmirrored;
  return counts;
}

// Lightweight JS/TS structural scan for the test-integrity guard (TD-222 / #1818).
// Dependency-free: the integrity CI job runs this judge without `npm ci`.
//
// Replaces regex-on-text for assertion counts and skip/return markers so that
// strings and comments are not misread, and so `if (cond) return;` / `return; x`
// are visible as bare returns. Also flags empty / assertion-free test callbacks.

const ASSERT_ROOTS = new Set(['expect', 'assert']);
const MARKER_MEMBERS = new Set(['skip', 'skipIf', 'runIf', 'only', 'todo', 'fixme', 'ignore']);
const X_PREFIXED = new Set(['xit', 'xdescribe', 'xtest']);
const OPTION_KEYS = new Set(['skip', 'only', 'ignore']);
// `describe` wrappers hold nested tests; only leaf `it` / `test` are checked.
const TEST_CALLEES = new Set(['it', 'test']);

/**
 * Scan JS/TS source for assertion calls, gate-weakening markers, bare returns
 * and empty / assertion-free test callbacks.
 */
export function scanJsTestSource(source) {
  const text = source ?? '';
  return analyze(tokenize(text), text);
}

/** Count `expect` / `assert` call expressions (member chains and type args allowed). */
export function countJsAssertions(source) {
  return scanJsTestSource(source).assertions;
}

/**
 * Gate-weakening findings in `source`, each with 1-based `lineNo` and the
 * exact trimmed source line (for reviewed-skip matching).
 */
export function findJsWeakening(source) {
  const { markers, bareReturns, emptyTests } = scanJsTestSource(source);
  return [...markers, ...bareReturns, ...emptyTests];
}

function analyze(tokens, source) {
  const lines = source.split('\n');
  const lineText = (lineNo) => (lines[lineNo - 1] ?? '').trim();
  const markers = [];
  const bareReturns = [];
  const emptyTests = [];
  let assertions = 0;
  let i = 0;

  const peek = (n = 0) => tokens[i + n];
  const take = () => tokens[i++];

  while (i < tokens.length) {
    const t = peek();

    // assert / expect (.member)* <Type>? (
    if (t.kind === 'id' && ASSERT_ROOTS.has(t.value)) {
      let j = i + 1;
      while (tokens[j]?.kind === 'punct' && tokens[j].value === '.' && tokens[j + 1]?.kind === 'id') j += 2;
      if (tokens[j]?.kind === 'punct' && tokens[j].value === '<') j = skipBalanced(tokens, j, '<', '>');
      if (tokens[j]?.kind === 'punct' && tokens[j].value === '(') {
        assertions += 1;
        i = j + 1;
        continue;
      }
    }

    // Deno.test.ignore / Deno.test.only
    if (
      t.kind === 'id' &&
      t.value === 'Deno' &&
      tokens[i + 1]?.value === '.' &&
      tokens[i + 2]?.value === 'test' &&
      tokens[i + 3]?.value === '.' &&
      tokens[i + 4]?.kind === 'id' &&
      (tokens[i + 4].value === 'ignore' || tokens[i + 4].value === 'only')
    ) {
      markers.push({ why: 'Deno.test.ignore / only', lineNo: t.line, lineText: lineText(t.line) });
      i += 5;
      continue;
    }

    // .skip / .only / .todo / … after an identifier or call/index result
    if (t.kind === 'punct' && t.value === '.' && peek(1)?.kind === 'id' && MARKER_MEMBERS.has(peek(1).value)) {
      const prev = tokens[i - 1];
      if (prev && (prev.kind === 'id' || (prev.kind === 'punct' && (prev.value === ')' || prev.value === ']')))) {
        markers.push({
          why: 'skip / focus / todo / conditional marker',
          lineNo: peek(1).line,
          lineText: lineText(peek(1).line),
        });
        i += 2;
        continue;
      }
    }

    // xit( / xdescribe( / xtest(
    if (t.kind === 'id' && X_PREFIXED.has(t.value) && peek(1)?.kind === 'punct' && peek(1).value === '(') {
      markers.push({ why: 'disabled test (x-prefix)', lineNo: t.line, lineText: lineText(t.line) });
      i += 2;
      continue;
    }

    // { skip: true } / only: true / ignore: true
    if (
      t.kind === 'id' &&
      OPTION_KEYS.has(t.value) &&
      peek(1)?.kind === 'punct' &&
      peek(1).value === ':' &&
      peek(2)?.kind === 'id' &&
      peek(2).value === 'true'
    ) {
      markers.push({ why: 'skip / only / ignore test option', lineNo: t.line, lineText: lineText(t.line) });
      i += 3;
      continue;
    }

    // bare return (no argument): `return;` / `return` / `if (x) return;`
    if (t.kind === 'id' && t.value === 'return') {
      const next = peek(1);
      const bare =
        !next ||
        (next.kind === 'punct' && (next.value === ';' || next.value === '}' || next.value === ')' || next.value === ','));
      if (bare) {
        bareReturns.push({
          why: 'bare `return` (can end a test body before its assertions)',
          lineNo: t.line,
          lineText: lineText(t.line),
        });
      }
      take();
      continue;
    }

    // it/test( … ) — option markers live inside the call args; empty callbacks too
    if (t.kind === 'id' && TEST_CALLEES.has(t.value) && peek(1)?.kind === 'punct' && peek(1).value === '(') {
      const callLine = t.line;
      i += 2;
      const args = readCallArgs(tokens, i);
      i = args.end;
      const disabled = findDisableOption(args.all);
      if (disabled) {
        markers.push({
          why: 'skip / only / ignore test option',
          lineNo: disabled.line,
          lineText: lineText(disabled.line),
        });
      } else if (args.callback && callbackHasNoAssertions(args.callback)) {
        emptyTests.push({
          why: 'empty or assertion-free test callback',
          lineNo: callLine,
          lineText: lineText(callLine),
        });
      }
      continue;
    }

    take();
  }

  return { assertions, markers, bareReturns, emptyTests };
}

function skipBalanced(tokens, start, open, close) {
  let i = start;
  let depth = 0;
  for (; i < tokens.length; i++) {
    if (tokens[i].kind === 'punct' && tokens[i].value === open) depth += 1;
    else if (tokens[i].kind === 'punct' && tokens[i].value === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return start + 1;
}

/** Read call args from `start` (first token inside `(`); returns callback body if any. */
function readCallArgs(tokens, start) {
  let i = start;
  let depth = 1;
  let argTokens = [];
  const args = [];
  const all = [];
  const flush = () => {
    if (argTokens.length) args.push(argTokens);
    argTokens = [];
  };
  while (i < tokens.length && depth > 0) {
    const t = tokens[i];
    if (t.kind === 'punct' && (t.value === '(' || t.value === '{' || t.value === '[')) depth += 1;
    if (t.kind === 'punct' && (t.value === ')' || t.value === '}' || t.value === ']')) {
      depth -= 1;
      if (depth === 0) {
        flush();
        i += 1;
        break;
      }
    }
    if (depth === 1 && t.kind === 'punct' && t.value === ',') {
      flush();
      i += 1;
      continue;
    }
    if (depth >= 1) {
      argTokens.push(t);
      all.push(t);
    }
    i += 1;
  }
  return { end: i, callback: args.find(isCallbackArg) ?? null, all };
}

/** The `skip|only|ignore: true` token inside call args, if any. */
function findDisableOption(toks) {
  for (let i = 0; i < toks.length - 2; i++) {
    if (
      toks[i].kind === 'id' &&
      OPTION_KEYS.has(toks[i].value) &&
      toks[i + 1].kind === 'punct' &&
      toks[i + 1].value === ':' &&
      toks[i + 2].kind === 'id' &&
      toks[i + 2].value === 'true'
    ) {
      return toks[i];
    }
  }
  return null;
}

function isCallbackArg(toks) {
  if (!toks.length) return false;
  let i = 0;
  if (toks[i]?.kind === 'id' && toks[i].value === 'async') i += 1;
  if (toks[i]?.kind === 'id' && toks[i].value === 'function') return toks;
  if (toks[i]?.kind === 'punct' && toks[i].value === '(') {
    return toks.some((t) => t.kind === 'punct' && t.value === '=>') ? toks : null;
  }
  // bare identifier arrow: x => …
  if (toks[i]?.kind === 'id' && toks[i + 1]?.kind === 'punct' && toks[i + 1].value === '=>') return toks;
  return null;
}

function callbackHasNoAssertions(toks) {
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind !== 'id' || !ASSERT_ROOTS.has(t.value)) continue;
    let j = i + 1;
    while (toks[j]?.kind === 'punct' && toks[j].value === '.' && toks[j + 1]?.kind === 'id') j += 2;
    if (toks[j]?.kind === 'punct' && toks[j].value === '<') j = skipBalanced(toks, j, '<', '>');
    if (toks[j]?.kind === 'punct' && toks[j].value === '(') return false;
  }
  return true;
}

/**
 * Tokenize JS/TS into identifiers, punctuators and numbers. Comments and
 * string/template literal *contents* are consumed and not emitted, so a marker
 * or assertion hidden inside a string never counts.
 */
export function tokenize(source) {
  const tokens = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const text = source ?? '';
  const col = () => i - lineStart + 1;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      line += 1;
      lineStart = i + 1;
      i += 1;
      continue;
    }

    if (ch === '/' && next === '/') {
      i += 2;
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') {
          line += 1;
          lineStart = i + 1;
        }
        i += 1;
      }
      i += 2;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < text.length) {
        const c = text[i];
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (quote === '`' && c === '$' && text[i + 1] === '{') {
          i += 2;
          const skipped = skipTemplateExpr(text, i, line, lineStart);
          i = skipped.i;
          line = skipped.line;
          lineStart = skipped.lineStart;
          continue;
        }
        if (c === quote) {
          i += 1;
          break;
        }
        if (c === '\n') {
          line += 1;
          lineStart = i + 1;
        }
        i += 1;
      }
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(next ?? ''))) {
      const startCol = col();
      const start = i;
      i += 1;
      while (i < text.length && /[0-9_]/.test(text[i])) i += 1;
      tokens.push({ kind: 'num', value: text.slice(start, i), line, col: startCol });
      continue;
    }

    if (/[A-Za-z_$]/.test(ch)) {
      const startCol = col();
      const start = i;
      i += 1;
      while (i < text.length && /[A-Za-z0-9_$]/.test(text[i])) i += 1;
      tokens.push({ kind: 'id', value: text.slice(start, i), line, col: startCol });
      continue;
    }

    if (ch === '=' && next === '>') {
      tokens.push({ kind: 'punct', value: '=>', line, col: col() });
      i += 2;
      continue;
    }

    tokens.push({ kind: 'punct', value: ch, line, col: col() });
    i += 1;
  }

  return tokens;
}

/** Advance past a `${ … }` template expression, respecting nested braces/strings. */
function skipTemplateExpr(text, start, line, lineStart) {
  let i = start;
  let depth = 1;
  while (i < text.length && depth > 0) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '\n') {
      line += 1;
      lineStart = i + 1;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') {
          line += 1;
          lineStart = i + 1;
        }
        i += 1;
      }
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const q = ch;
      i += 1;
      while (i < text.length) {
        if (text[i] === '\\') {
          i += 2;
          continue;
        }
        if (text[i] === q) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
    i += 1;
  }
  return { i, line, lineStart };
}

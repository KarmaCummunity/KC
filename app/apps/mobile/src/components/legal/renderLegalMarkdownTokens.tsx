// Walk markdown-it tokens into React Native Text/View for the legal-doc subset
// (headings, paragraphs, bold/italic, lists, links, hr, blockquotes). Links open
// only through `openExternalUrl` (http/https/mailto/tel).

import React from 'react';
import { View } from 'react-native';
import type Token from 'markdown-it/lib/token.mjs';
import { Text } from '@kc/ui';
import { openExternalUrl } from '../../utils/openExternalUrl';
import type { LegalMarkdownStyleMap } from './LegalMarkdownStyles';

export type LegalMarkdownRenderCtx = {
  readonly styles: LegalMarkdownStyleMap;
};

const HEADING_STYLE_KEY = {
  h1: 'heading1',
  h2: 'heading2',
  h3: 'heading3',
  h4: 'heading4',
  h5: 'heading5',
  h6: 'heading6',
} as const;

function findClose(tokens: Token[], openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i += 1) {
    depth += tokens[i].nesting;
    if (depth === 0) return i;
  }
  return tokens.length - 1;
}

function pressSafeLink(href: string): (() => void) | undefined {
  if (!href) return undefined;
  return () => {
    try {
      openExternalUrl(href);
    } catch {
      /* ignore unsafe schemes */
    }
  };
}

function renderInline(tokens: Token[] | null, ctx: LegalMarkdownRenderCtx, keyBase: string): React.ReactNode[] {
  if (!tokens?.length) return [];
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.type === 'text') {
      out.push(token.content);
      i += 1;
      continue;
    }
    if (token.type === 'softbreak' || token.type === 'hardbreak') {
      out.push('\n');
      i += 1;
      continue;
    }
    if (token.type === 'code_inline') {
      out.push(
        <Text key={`${keyBase}-code-${i}`} style={ctx.styles.strong}>
          {token.content}
        </Text>,
      );
      i += 1;
      continue;
    }
    if (token.type === 'strong_open' || token.type === 'em_open') {
      const close = findClose(tokens, i);
      const inner = renderInline(tokens.slice(i + 1, close), ctx, `${keyBase}-${token.type}-${i}`);
      const style = token.type === 'strong_open' ? ctx.styles.strong : ctx.styles.em;
      out.push(
        <Text key={`${keyBase}-${token.type}-${i}`} style={style}>
          {inner}
        </Text>,
      );
      i = close + 1;
      continue;
    }
    if (token.type === 'link_open') {
      const close = findClose(tokens, i);
      const href = token.attrGet('href') ?? '';
      const inner = renderInline(tokens.slice(i + 1, close), ctx, `${keyBase}-link-${i}`);
      out.push(
        <Text
          key={`${keyBase}-link-${i}`}
          accessibilityRole="link"
          onPress={pressSafeLink(href)}
          style={ctx.styles.link}
        >
          {inner}
        </Text>,
      );
      i = close + 1;
      continue;
    }
    i += 1;
  }
  return out;
}

/** Flatten block children of a list item into inline runs (no nested paragraph margins). */
function renderListItemBody(tokens: Token[], ctx: LegalMarkdownRenderCtx, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.type === 'paragraph_open') {
      const close = findClose(tokens, i);
      const inner = tokens.slice(i + 1, close);
      for (const child of inner) {
        if (child.type === 'inline') {
          out.push(...renderInline(child.children, ctx, `${keyBase}-p-${i}`));
        }
      }
      i = close + 1;
      continue;
    }
    if (token.type === 'inline') {
      out.push(...renderInline(token.children, ctx, `${keyBase}-i-${i}`));
      i += 1;
      continue;
    }
    if (token.nesting === 1) {
      i = findClose(tokens, i) + 1;
      continue;
    }
    i += 1;
  }
  return out;
}

function renderList(tokens: Token[], ordered: boolean, ctx: LegalMarkdownRenderCtx, key: string): React.ReactNode {
  const items: React.ReactNode[] = [];
  let i = 0;
  let index = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.type !== 'list_item_open') {
      i += 1;
      continue;
    }
    const close = findClose(tokens, i);
    const body = renderListItemBody(tokens.slice(i + 1, close), ctx, `${key}-li-${index}`);
    const bullet = ordered ? `${index + 1}.` : '•';
    items.push(
      <View key={`${key}-li-${index}`} style={ctx.styles.listItem}>
        <Text style={ctx.styles.listIcon}>{bullet}</Text>
        <Text style={ctx.styles.listContent}>{body}</Text>
      </View>,
    );
    index += 1;
    i = close + 1;
  }
  return (
    <View key={key} style={ctx.styles.list}>
      {items}
    </View>
  );
}

function renderBlocks(tokens: Token[], ctx: LegalMarkdownRenderCtx, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.type === 'hr') {
      out.push(<View key={`${keyBase}-hr-${i}`} testID="legal-md-hr" style={ctx.styles.hr} />);
      i += 1;
      continue;
    }
    if (token.nesting !== 1) {
      i += 1;
      continue;
    }
    const close = findClose(tokens, i);
    const inner = tokens.slice(i + 1, close);
    const key = `${keyBase}-${token.type}-${i}`;

    if (token.type === 'heading_open') {
      const styleKey = HEADING_STYLE_KEY[token.tag as keyof typeof HEADING_STYLE_KEY] ?? 'heading3';
      const children = inner.flatMap((t, j) =>
        t.type === 'inline' ? renderInline(t.children, ctx, `${key}-in-${j}`) : [],
      );
      out.push(
        <Text key={key} accessibilityRole="header" style={ctx.styles[styleKey]}>
          {children}
        </Text>,
      );
    } else if (token.type === 'paragraph_open') {
      const children = inner.flatMap((t, j) =>
        t.type === 'inline' ? renderInline(t.children, ctx, `${key}-in-${j}`) : [],
      );
      out.push(
        <Text key={key} style={ctx.styles.paragraph}>
          {children}
        </Text>,
      );
    } else if (token.type === 'bullet_list_open') {
      out.push(renderList(inner, false, ctx, key));
    } else if (token.type === 'ordered_list_open') {
      out.push(renderList(inner, true, ctx, key));
    } else if (token.type === 'blockquote_open') {
      out.push(
        <View key={key} style={ctx.styles.blockquote}>
          {renderBlocks(inner, ctx, key)}
        </View>,
      );
    }

    i = close + 1;
  }
  return out;
}

/** Render a top-level markdown-it token list to RN nodes. */
export function renderLegalMarkdownTokens(
  tokens: Token[],
  ctx: LegalMarkdownRenderCtx,
): React.ReactNode[] {
  return renderBlocks(tokens, ctx, 'md');
}

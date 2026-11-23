// In-house Markdown renderer for legal documents (FR-SETTINGS-010, #1789).
// Parses with maintained markdown-it@14 and maps the legal subset to RN Text/View.

import { useMemo } from 'react';
import MarkdownIt from 'markdown-it';
import type { ColorPalette } from '@kc/ui';
import { makeLegalMarkdownStyles } from './LegalMarkdownStyles';
import { renderLegalMarkdownTokens } from './renderLegalMarkdownTokens';

// html:false — never execute raw HTML from server-authored legal copy.
// linkify:true — bare https URLs in the Hebrew legal texts become tappable links.
const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

interface LegalMarkdownProps {
  readonly children: string;
  readonly colors: ColorPalette;
}

export function LegalMarkdown({ children, colors }: LegalMarkdownProps) {
  const styles = useMemo(() => makeLegalMarkdownStyles(colors), [colors]);
  const nodes = useMemo(() => {
    const tokens = md.parse(children, {});
    return renderLegalMarkdownTokens(tokens, { styles });
  }, [children, styles]);
  return <>{nodes}</>;
}

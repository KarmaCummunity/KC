// Renders the Open Graph document a link-preview crawler reads. Every value is escaped: the post
// title and description are user input.

import { he } from '../i18n/he.mjs';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

/** @param {{ title: string, description: string, imageUrl: string }} card */
export function renderOgHtml(card, canonicalUrl) {
  const title = escapeHtml(card.title);
  const description = escapeHtml(card.description);
  const image = escapeHtml(card.imageUrl);
  const canonical = escapeHtml(canonicalUrl);
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<meta name="description" content="${description}" />
<link rel="canonical" href="${canonical}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="${escapeHtml(he.appName)}" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" />
<meta property="og:image" content="${image}" />
<meta property="og:image:alt" content="${title}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:locale" content="he_IL" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${description}" />
<meta name="twitter:image" content="${image}" />
</head>
<body>
<noscript><a href="${canonical}">${title}</a></noscript>
</body>
</html>`;
}

// Renders the Open Graph document a link-preview crawler reads. Every value is escaped: the post
// title and description are user input.

import { he } from '../i18n/he.mjs';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

/** og:image and its description; width and height only when they were measured. */
function imageTags(image) {
  const url = escapeHtml(image.url);
  const tags = [`<meta property="og:image" content="${url}" />`];
  if (image.url.startsWith('https://')) tags.push(`<meta property="og:image:secure_url" content="${url}" />`);
  tags.push(`<meta property="og:image:type" content="${escapeHtml(image.type)}" />`);
  if (Number.isInteger(image.width) && Number.isInteger(image.height)) {
    tags.push(`<meta property="og:image:width" content="${image.width}" />`);
    tags.push(`<meta property="og:image:height" content="${image.height}" />`);
  }
  return tags.join('\n');
}

/**
 * @param {{ title: string, description: string,
 *           image: { url: string, type: string, width: number | null, height: number | null } }} card
 */
export function renderOgHtml(card, canonicalUrl) {
  const title = escapeHtml(card.title);
  const description = escapeHtml(card.description);
  const image = escapeHtml(card.image.url);
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
${imageTags(card.image)}
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

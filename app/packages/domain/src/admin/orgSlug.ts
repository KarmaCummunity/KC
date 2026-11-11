// FR-ORG-002 — the web address (`organizations.slug`) an approved application gives the new
// organization: lowercase Latin letters and digits in up to ten hyphen-joined words, at most 60
// characters (the check of the `organizations` table). The reviewer chooses it on approval.

const ORG_SLUG = /^[a-z0-9]+(-[a-z0-9]+){0,9}$/;
const ORG_SLUG_MAX = 60;
const MAX_WORDS = 10;

export function isValidOrgSlug(slug: string): boolean {
  return slug.length <= ORG_SLUG_MAX && ORG_SLUG.test(slug);
}

/** The lowercase Latin words of `text`, hyphen-joined, within the slug limits ('' when none). */
function slugWords(text: string): string {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 0).slice(0, MAX_WORDS);
  return words.join('-').slice(0, ORG_SLUG_MAX).replace(/-+$/, '');
}

/**
 * A first suggestion for the reviewer: the Latin words of the organization name, else the first
 * label of its website's host name (`www.` aside); '' when neither has a Latin letter or digit
 * (a Hebrew name without a website), and the reviewer types one.
 */
export function suggestOrgSlug(orgName: string, websiteUrl: string | null): string {
  const fromName = slugWords(orgName);
  if (fromName) return fromName;
  const host = /^https?:\/\/([^/?#]+)/i.exec(websiteUrl ?? '')?.[1] ?? '';
  return slugWords(host.replace(/^www\./i, '').split('.')[0] ?? '');
}

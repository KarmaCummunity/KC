/**
 * The text without its trailing slashes, in one pass from the end. Used on
 * base addresses before a path is appended; a loop, not a pattern, so its
 * cost is linear in the text whatever the text is.
 */
export function withoutTrailingSlashes(text: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === '/') end -= 1;
  return text.slice(0, end);
}

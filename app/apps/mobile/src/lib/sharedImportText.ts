// Mapped to spec: FR-IMPORT-001 AC1 — what the OS share sheet hands the import screen. The web share
// target (manifest `share_target`) opens `/import-post?title=…&text=…&url=…`; apps fill these
// fields differently (WhatsApp puts everything in `text`, a browser splits title and link), so the
// pieces are joined once, without repeating a piece another already holds.

export interface SharedImportParams {
  readonly title?: string | string[];
  readonly text?: string | string[];
  readonly url?: string | string[];
}

/** Expo Router may hand a repeated query key over as an array; keep the first value. */
function first(value: string | string[] | undefined): string {
  return ((Array.isArray(value) ? value[0] : value) ?? '').trim();
}

/** The shared message as one text for the paste field, or null when nothing was shared. */
export function sharedImportText(params: SharedImportParams): string | null {
  const pieces: string[] = [];
  for (const piece of [first(params.title), first(params.text), first(params.url)]) {
    // The link is scrubbed server-side like any other; it stays so the member sees what was shared.
    if (piece !== '' && !pieces.some((kept) => kept.includes(piece))) pieces.push(piece);
  }
  return pieces.length > 0 ? pieces.join('\n') : null;
}

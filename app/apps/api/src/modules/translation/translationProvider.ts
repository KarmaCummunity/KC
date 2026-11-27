// The seam between KC's translation rules and whoever translates
// (FR-TRANSLATE-002). Swapping the provider is a configuration change
// (`KC_TRANSLATION_PROVIDER`), not a code change.

export interface ProviderInput {
  readonly text: string;
  /** BCP-47 target; may be variant-specific (e.g. `zh-Hant`). */
  readonly targetLanguage: string;
  /** Optional hint; the provider still detects the source language itself. */
  readonly sourceHint?: string | null;
}

export interface ProviderResult {
  readonly translatedText: string;
  readonly detectedSourceLanguage: string | null;
  /** 0..1 self-rated confidence; null when the provider gives none. */
  readonly confidence: number | null;
  /** Model or provider id, stored as provenance in `content_translations.model`. */
  readonly model: string;
}

export interface TranslationProvider {
  /** Rejects when the provider could not translate; the caller decides what the member sees. */
  translate(input: ProviderInput): Promise<ProviderResult>;
}

/** Injection token of the configured `TranslationProvider` (replaced in tests, so none reaches the network). */
export const TRANSLATION_PROVIDER = Symbol('TRANSLATION_PROVIDER');

/**
 * Translates many texts with at most `concurrency` provider calls in flight,
 * keeping the order of `inputs`. A text the provider fails on resolves to
 * null (the caller shows the original) and never fails the whole batch.
 * @param onFailure Receives each failed item's index and error, for the log.
 */
export async function translateMany(
  provider: TranslationProvider,
  inputs: readonly ProviderInput[],
  concurrency: number,
  onFailure: (index: number, error: unknown) => void = () => undefined,
): Promise<(ProviderResult | null)[]> {
  const results = new Array<ProviderResult | null>(inputs.length).fill(null);
  let next = 0;
  // Each worker takes the next unclaimed index until none is left; `next++` is atomic between awaits.
  const worker = async (): Promise<void> => {
    while (next < inputs.length) {
      const index = next++;
      try {
        results[index] = await provider.translate(inputs[index] as ProviderInput);
      } catch (error) {
        onFailure(index, error);
      }
    }
  };
  const workers = Math.max(1, Math.min(concurrency, inputs.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

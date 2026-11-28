import type { GeminiClient } from '../../platform/ai/geminiClient';
import { buildUserPayload, EXTRACTION_RESPONSE_SCHEMA, EXTRACTION_SYSTEM } from './extractionPrompt';
import type { ExtractionProviderInput, ExtractionProviderResult, PostExtractionProvider } from './extractionProvider';

/**
 * Gemini Flash behind the extraction seam. The free tier is not
 * zero-retention: the model under a data-processing agreement must be in place
 * before public launch (D-63 parity, FR-IMPORT-009 AC2). Only the scrubbed
 * text is ever sent (FR-IMPORT-002 AC3). A missing key fails per call, so the
 * rest of the import flow (the manual route) keeps working without one.
 */
export class GeminiExtractionProvider implements PostExtractionProvider {
  constructor(private readonly gemini: GeminiClient) {}

  async extract(input: ExtractionProviderInput): Promise<ExtractionProviderResult> {
    const raw = await this.gemini.generateJson({
      systemInstruction: EXTRACTION_SYSTEM,
      userText: buildUserPayload(input),
      responseSchema: EXTRACTION_RESPONSE_SCHEMA,
    });
    return { raw, model: this.gemini.model };
  }
}

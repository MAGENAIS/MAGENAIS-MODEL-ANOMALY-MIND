/**
 * contract.ts
 *
 * A self-contained copy of the small portion of the MAGENAIS Model contract
 * (Model / ModelManifest / ModelRequest / ModelResponse) that this package
 * needs, so AnomalyMind has ZERO dependency on MAGENAIS itself and can be
 * cloned, installed, and used entirely on its own.
 *
 * This mirrors — deliberately, field-for-field — the shared contract
 * published in the MAGENAIS-MODELS catalog repository's
 * schemas/model-manifest.schema.json and schemas/model-response.schema.json,
 * so that MAGENAIS's own adapter can wrap this package's AnomalyMindModel
 * without any shape translation. If those schemas ever change, update this
 * file to match — do not let it drift silently. Byte-identical to
 * MAGENAIS-MODEL-DECISION-SCORE/src/contract.ts and
 * MAGENAIS-MODEL-PATTERN-SENSE/src/contract.ts aside from this comment,
 * per the established precedent of copying rather than reinventing.
 */

export type ModelType = 'algorithm' | 'ml' | 'llm' | 'vision' | 'audio' | 'graph' | 'hybrid';
export type ModelPricingType = 'free' | 'paid' | 'freemium' | 'enterprise';
export type ModelTrustLevel = 'magenais-verified' | 'community-verified' | 'experimental' | 'unverified';

export interface ModelManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: { name: string; organization?: string };
  type: ModelType;
  capabilities: string[];
  runtimes: string[];
  license: { type: string; url?: string };
  pricing: { type: ModelPricingType };
  trust: ModelTrustLevel;
  uri?: string;
  repository?: string;
  documentation?: string;
}

export interface ModelRequest<TInput = unknown> {
  input: TInput;
  context?: unknown;
  options?: unknown;
}

export interface ModelResponse<T = unknown> {
  success: boolean;
  modelId: string;
  modelVersion: string;
  output: T;
  confidence?: number;
  evidence?: unknown;
  explanation?: string;
  warnings?: string[];
  metadata?: {
    runtime?: string;
    executionTimeMs?: number;
    datasetSize?: number;
    algorithm?: string;
  };
}

export interface Model<TInput = unknown, TOutput = unknown> {
  readonly manifest: ModelManifest;
  execute(request: ModelRequest<TInput>): Promise<ModelResponse<TOutput>>;
}

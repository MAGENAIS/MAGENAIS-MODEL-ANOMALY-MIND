/**
 * AnomalyMindModel.ts
 *
 * Wraps AnomalyMindAlgorithm + AnomalyContextStability behind the shared
 * `Model` interface (./contract.ts — a self-contained copy, see that
 * file's header) so this package has ZERO dependency on MAGENAIS itself.
 * When bundled inside MAGENAIS (src/models/anomaly-mind/), the only
 * difference is that file's version of this import points at
 * ../types/*.ts instead of ./contract.ts — everything else is identical.
 *
 * trust is 'experimental' until this model passes MAGENAIS's verification
 * process (MASTER PROMPT §36) — do not bump to 'magenais-verified' here.
 */

import type { Model, ModelManifest, ModelRequest, ModelResponse } from './contract.ts';
import {
  validateInput,
  validateRunOptions,
  resolveVariableNames,
  inferNumericVariables,
  detectAnomaliesForVariable,
  resolveDefaultThreshold,
  buildFlagExplanation,
  DEFAULT_WINDOW,
} from './AnomalyMindAlgorithm.ts';
import { computeACS, classifyStability, CONTEXT_STABILITY_DISCLAIMER } from './AnomalyContextStability.ts';
import type { AnomalyMindInput, AnomalyMindOutput, AnomalyMindRunOptions, AnomalyFlag, AnomalyDetectionMethod } from './types.ts';

export const ANOMALY_MIND_MANIFEST: ModelManifest = {
  id: 'magenais.anomaly-mind',
  name: 'AnomalyMind',
  version: '1.0.0',
  description:
    'Lightweight, local, explainable anomaly detection over numeric tabular/time-series data. Flags outliers ' +
    'using simple, well-understood statistical methods (median absolute deviation, robust Z-score, IQR, rolling ' +
    'local statistics — no neural network) and reports an Anomaly Context Stability (ACS) score distinguishing ' +
    'a threshold-sensitive anomaly from one that holds up across tested threshold/window/method/subset variations.',
  author: { name: 'MAGENAIS', organization: 'MAGENAIS' },
  type: 'algorithm',
  capabilities: ['anomaly-detection', 'time-series-analysis'],
  runtimes: ['builtin-local'],
  license: { type: 'Apache-2.0' },
  pricing: { type: 'free' },
  trust: 'experimental',
  uri: 'magenais://anomaly-mind@1.0.0',
  repository: 'MAGENAIS-MODEL-ANOMALY-MIND',
};

// NOTE: CONTEXT_STABILITY_DISCLAIMER is imported above for use in this file only.
// It is NOT re-exported here — it's already exported once from
// AnomalyContextStability.ts, and index.ts's `export *` for both files would
// otherwise re-create the exact TS2308 "already exported a member" collision
// documented in PHASE-9-BUILD-FIX.md, this time inside anomaly-mind's own
// barrel. Every model barrel must export each name from exactly one file.

const DEFAULT_METHOD: AnomalyDetectionMethod = 'mad';

export class AnomalyMindModel implements Model<AnomalyMindInput, AnomalyMindOutput> {
  readonly manifest: ModelManifest = ANOMALY_MIND_MANIFEST;

  async execute(request: ModelRequest<AnomalyMindInput>): Promise<ModelResponse<AnomalyMindOutput>> {
    const input = request.input;
    validateInput(input);

    const runOptions = (request.options ?? {}) as AnomalyMindRunOptions;
    validateRunOptions(runOptions.method);

    const method = runOptions.method ?? DEFAULT_METHOD;
    const threshold = runOptions.threshold ?? resolveDefaultThreshold(method);
    const window = runOptions.window ?? Math.min(DEFAULT_WINDOW, Math.max(3, input.records.length - 1));

    const variableNames = resolveVariableNames(input);
    const { numeric: variablesConsidered, skipped: variablesSkipped } = inferNumericVariables(
      input.records,
      variableNames
    );

    const anomalies: AnomalyFlag[] = [];
    for (const variable of variablesConsidered) {
      const results = detectAnomaliesForVariable(input.records, variable, method, threshold, window);
      for (const result of results) {
        if (!result.isAnomaly) continue;

        const acsResult = computeACS(
          input.records,
          variable,
          result.index,
          { threshold, window },
          { trials: runOptions.acsTrials, seed: runOptions.seed }
        );
        const stability = classifyStability(acsResult);

        anomalies.push({
          index: result.index,
          variable,
          value: result.value,
          method,
          score: result.score,
          threshold,
          isAnomaly: true,
          acs: acsResult.acs,
          stability,
          explanation: buildFlagExplanation(variable, method, result.score, threshold, acsResult.acs, stability),
        });
      }
    }

    // Most notable first: largest deviation score magnitude first.
    anomalies.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

    const output: AnomalyMindOutput = {
      anomalies,
      variablesConsidered,
      variablesSkipped,
      rowCount: input.records.length,
      method,
    };

    const stableCount = anomalies.filter((a) => a.stability === 'stable').length;
    const warnings: string[] = [CONTEXT_STABILITY_DISCLAIMER];
    if (variablesConsidered.length === 0) {
      warnings.push('No numeric variables were available — no anomalies could be evaluated.');
    }
    if (variablesSkipped.length > 0) {
      warnings.push(`Non-numeric variables were not analyzed: ${variablesSkipped.join(', ')}.`);
    }
    if (input.records.length < 5) {
      warnings.push('Fewer than 5 rows: Anomaly Context Stability could not be reliably tested for most observations.');
    }

    return {
      success: true,
      modelId: this.manifest.id,
      modelVersion: this.manifest.version,
      output,
      confidence: anomalies.length > 0 ? anomalies.reduce((s, a) => s + a.acs, 0) / anomalies.length : 1,
      evidence: { variablesEvaluated: variablesConsidered.length, anomaliesFlagged: anomalies.length, stableAnomalies: stableCount },
      explanation:
        anomalies.length > 0
          ? `Flagged ${anomalies.length} anomalous observation(s) across ${variablesConsidered.length} numeric ` +
            `variable(s) and ${input.records.length} rows using the ${method} method (threshold ${threshold}); ` +
            `${stableCount} of ${anomalies.length} held up as stable anomalies under tested variations.`
          : `No anomalies found across ${variablesConsidered.length} numeric variable(s) and ${input.records.length} rows ` +
            `using the ${method} method (threshold ${threshold}).`,
      warnings,
      metadata: {
        datasetSize: input.records.length,
        algorithm: method,
      },
    };
  }
}

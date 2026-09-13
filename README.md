# AnomalyMind

Lightweight, local, explainable anomaly detection over numeric
tabular/time-series/sensor data. Part of the
[MAGENAIS Model Hub](https://github.com/MAGENAIS/MAGENAIS-MODELS), but
fully independent — you can use this package without installing or
running MAGENAIS at all.

> **Research-oriented.** AnomalyMind is a MAGENAIS research model. Its
> metric (ACS) is an original name for a well-understood idea — testing a
> flagged observation's stability by resampling the detection
> configuration — applied to lightweight anomaly detection; no novelty
> claim is made beyond that framing. See
> [Research direction](#research-direction).

## What it does

Given a set of **records** (rows of a table — from CSV, JSON, sensor logs,
or any tabular source), AnomalyMind:

1. Infers which columns are numeric (non-numeric columns are reported back
   as `variablesSkipped`, never silently dropped).
2. Scores every present numeric value in every considered variable using
   **one** of four simple, explainable methods — no neural network:
   - **MAD** — median absolute deviation rule of thumb.
   - **Robust (modified) Z-score** — the standard Iglewicz & Hoaglin
     MAD-scaled z-score.
   - **IQR** — the classic Tukey-fence interquartile-range rule.
   - **Rolling** — a local-neighborhood z-score, for time-series/sensor
     data where "normal" drifts over the series.
3. Flags a value anomalous when its deviation score exceeds the method's
   threshold.
4. Computes an **Anomaly Context Stability (ACS)** score for every flagged
   observation: the proportion of tested configurations — varying
   threshold, window, method (normalization), and row subset — under
   which the same observation stays flagged. Classifies each anomaly as
   `stable` (holds up broadly) or `threshold-sensitive` (only flagged
   under the exact baseline settings).

**AnomalyMind never presents a flag as certain** — every anomaly's
explanation states its ACS is a sensitivity estimate under tested
assumptions, not a guarantee.

## Input

```ts
interface AnomalyMindInput {
  records: Record<string, number | string | boolean | null | undefined>[];
  variables?: string[]; // restrict analysis to these columns; default = every numeric column present
}

interface AnomalyMindRunOptions {
  method?: 'mad' | 'robust-zscore' | 'iqr' | 'rolling'; // default 'mad'
  threshold?: number;   // default depends on method
  window?: number;      // 'rolling' method only; default 10 (or fewer, for small datasets)
  acsTrials?: number;   // default 30
  seed?: number;        // default 42 — same input + seed always reproduces the same ACS
}
```

## Output

```ts
interface AnomalyMindOutput {
  anomalies: {
    index: number;         // row index within the original records array
    variable: string;
    value: number;
    method: 'mad' | 'robust-zscore' | 'iqr' | 'rolling';
    score: number;         // method-specific deviation score; not comparable across methods
    threshold: number;
    isAnomaly: true;
    acs: number;           // 0–1, Anomaly Context Stability
    stability: 'stable' | 'threshold-sensitive' | 'untested';
    explanation: string;
  }[];
  variablesConsidered: string[];
  variablesSkipped: string[]; // present but not numeric
  rowCount: number;
  method: 'mad' | 'robust-zscore' | 'iqr' | 'rolling';
}
```

## Algorithm

- **MAD:** flag if `|x − median| / MAD > threshold` (default threshold `3`).
- **Robust (modified) Z-score:** flag if `|0.6745 × (x − median) / MAD| > threshold`
  (default `3.5`, the standard Iglewicz & Hoaglin cutoff).
- **IQR:** flag if `x` falls more than `threshold × IQR` beyond the nearer
  quartile (default `1.5`, the classic Tukey fence).
- **Rolling:** flag if `x`'s z-score against its own local neighborhood
  (excluding itself) exceeds `threshold` (default `3`, default `window` `10`).

See `docs/algorithm.md` for the full method, including how ACS's
configuration sampling works and how small datasets and missing values are
handled.

## Example

```ts
import { AnomalyMindModel } from '@magenais/anomaly-mind';

const model = new AnomalyMindModel();

const response = await model.execute({
  input: {
    records: [
      { t: 0, sensor: 100 }, { t: 1, sensor: 101 }, { t: 2, sensor: 99 },
      { t: 3, sensor: 250 }, // injected spike
      // ...
    ],
  },
  options: { seed: 42 },
});

for (const a of response.output.anomalies) {
  console.log(a.variable, a.index, a.value, a.stability, a.acs.toFixed(2));
}
```

See `examples/basic-usage.mjs` for a runnable version of this.

## Limitations

- Only univariate anomalies are modeled — no multivariate outlier
  detection (e.g. Mahalanobis distance) in v1.0.0.
- The `'rolling'` method's neighborhood near the start/end of a series has
  fewer points than a full window, which can make edge observations more
  sensitive to detection under this method than points in the middle of a
  series — a known accuracy limitation of a symmetric fixed-size window,
  not a bug.
- ACS's "normalization" variation cycles through the four built-in methods
  rather than testing arbitrary alternative normalizations (e.g.
  log-transform first) — it is not a substitute for choosing an
  appropriate transform for your data's distribution.
- ACS is a resampling-based heuristic, not a formal statistical
  significance test, and its cost scales with the number of flagged
  anomalies (see `SECURITY.md`).

## Research direction

ACS is designed to be subjected to literature review, benchmarking against
established outlier-detection stability/robustness measures, ablation
studies, and statistical validation. Contributions in that direction are
welcome — see `CONTRIBUTING.md`.

## Version

`1.0.0` — versioned independently of MAGENAIS itself.

## License

Apache-2.0. See `LICENSE`.

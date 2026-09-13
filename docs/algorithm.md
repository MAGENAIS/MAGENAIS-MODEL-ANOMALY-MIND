# Algorithm

## 0. Variable typing

Every column (record key) considered is classified as **numeric** or
**skipped**: numeric if every present (non-null, non-empty-string) value
across all rows is a number or a string that parses cleanly as one;
skipped otherwise (including a column with no present values at all).
AnomalyMind only analyzes numeric columns — non-numeric columns are
reported back in `variablesSkipped`, never silently dropped without
explanation.

## 1. MAD (median absolute deviation)

For a numeric variable, using only present values:

1. Compute the **median** and the **median absolute deviation** (`MAD` —
   the median of `|x − median|` across all present values).
2. `score = |x − median| / max(MAD, ε)` for each value (a tiny floor `ε`
   is used in place of an exact zero `MAD`, so a perfectly constant series
   still yields a finite, not `Infinity`/`NaN`, score for any genuinely
   different value).
3. Flag anomalous if `score > threshold` (default `3`).

## 2. Robust (modified) Z-score

Same underlying statistic as MAD (median + MAD), scaled by the standard
Iglewicz & Hoaglin constant:

1. `score = 0.6745 × (x − median) / max(MAD, ε)`.
2. Flag anomalous if `|score| > threshold` (default `3.5`, the
   conventional cutoff for this specific scaled metric).

Kept as a separate method from plain MAD (rather than folded into it) so
that Anomaly Context Stability's "normalization" variation (§4) has a real
second scaling to test, not just a relabeling of the same numbers.

## 3. IQR (interquartile range)

For a numeric variable, using only present values:

1. Compute quartiles via Tukey's hinges: the median of the lower half and
   the median of the upper half of the sorted values (excluding the
   overall median itself when the array has odd length). `IQR = Q3 − Q1`.
2. For each value: `beyond = max(Q1 − x, x − Q3, 0)`;
   `score = beyond / max(IQR, ε)`.
3. Flag anomalous if `score > threshold` (default `1.5`, the classic Tukey
   fence multiplier).

## 4. Rolling (local neighborhood)

For a numeric variable, using only present values, treated as an ordered
series:

1. For each value at position `i`, take its **neighborhood**: every other
   present value within `⌊window / 2⌋` positions of `i` (excluding the
   point itself, so an anomaly cannot inflate its own baseline).
2. Compute the neighborhood's mean and standard deviation.
3. `score = (x_i − neighborhoodMean) / max(neighborhoodStd, ε)`.
4. Flag anomalous if `|score| > threshold` (default `3`, default
   `window` `10`, or fewer for a small dataset).
5. If fewer than 2 neighbors are available (extremely small dataset),
   `score = 0` — never treated as anomalous by default in that case (not
   enough local context to judge).

This is the only one of the four methods that is inherently local — the
other three compute one global statistic (median/MAD or quartiles) across
the whole variable.

## 5. Anomaly Context Stability (ACS)

**Question it answers:** "Does this flagged observation stay anomalous
under reasonable variations in how anomaly detection is configured, or is
it only anomalous under one specific, possibly arbitrary, setting?"

**Method**, for one flagged observation (a specific row index and
variable):

1. Run `acsTrials` (default `30`) independent trials. Each trial, using a
   seeded PRNG ([mulberry32](https://github.com/bryc/code/blob/master/jshash/PRNGs.md),
   default seed `42`, so the same input + seed always reproduces the same
   ACS):
   - picks one of the four methods at random (the **normalization**
     variation),
   - jitters the baseline threshold by up to ±30% (the **threshold**
     variation),
   - jitters the baseline window by up to ±30%, for methods that use one
     (the **window** variation),
   - samples a random ~80%-of-rows subset that always force-includes the
     observation being tested (the **subset** variation), preserving row
     order within the subset (relevant to the rolling method).
2. Re-runs detection with that trial's method/threshold/window over that
   trial's subset, and checks whether the target observation is still
   flagged anomalous within the subset.
3. `ACS = (trials where the observation was still flagged) / (trials where
   the observation was evaluable at all)`. A trial where the observation's
   value wasn't evaluable in that subset is excluded from both the
   numerator and denominator — it carries no evidence either way, rather
   than being counted as "not anomalous."
4. If fewer than 5 trials were evaluable (an extremely small dataset),
   `ACS` defaults to `1` and is flagged `untested` — this should be read
   as "not enough data to test," not as a confirmed stable anomaly.
5. `stability` is `'stable'` if `ACS >= 0.7`, else `'threshold-sensitive'`
   (or `'untested'` per step 4).

**Interpretation:** `ACS = 1.0` means the observation stayed anomalous in
every evaluable trial — evidence it's a genuine outlier, not an artifact
of one specific threshold/window/method choice. `ACS = 0.5` means it was
flagged in only half the tested configurations: a caution sign that the
flag is sensitive to exactly how detection was configured, not a
generally agreed-upon anomaly.

## What this is not

- Not a multivariate method. Each variable is scored independently; no
  Mahalanobis distance, isolation forest, or other multivariate outlier
  technique is used in v1.0.0.
- Not a formal statistical test. `score` and `ACS` are deterministic,
  interpretable heuristics — neither is a p-value, and neither carries a
  formal significance guarantee.
- Not exhaustive. ACS's "normalization" variation only cycles through
  this package's own four methods — it does not test arbitrary data
  transforms (log, Box-Cox, etc.).

## Research direction

Candidate directions for follow-up validation (see `CONTRIBUTING.md`):

- Compare ACS's configuration-resampling approach against established
  outlier-detection robustness/stability measures.
- Extend beyond univariate detection (e.g. Mahalanobis distance, isolation
  forest) once a clear, explainable design is worked out — while keeping
  the existing lightweight methods as a fast, dependency-free default.
- Empirical calibration: for datasets with known ground-truth anomalies
  (simulated or benchmark), how well does ACS's `stable` classification
  track true positives vs. `threshold-sensitive` tracking false positives?

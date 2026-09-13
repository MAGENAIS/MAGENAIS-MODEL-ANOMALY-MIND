# Changelog

All notable changes to this project will be documented in this file.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/), and
this project uses [Semantic Versioning](https://semver.org/), independent
of MAGENAIS's own version.

## [Unreleased]

Nothing yet.

## [1.0.0] — not yet released

Prepared during MAGENAIS V4.1 Phase 10. Not yet published — see
`../ANOMALYMIND-REPO-READY.md` in the MAGENAIS repository for the publish
checklist and remaining GitHub-repository checkpoint (Phase 11).

### Added

- `AnomalyMindModel` implementing the shared `Model` contract
  (`execute()` → normalized `ModelResponse`).
- Four lightweight, explainable detection methods
  (`AnomalyMindAlgorithm.ts`): median absolute deviation (MAD), robust
  (modified) Z-score, interquartile range (IQR), and rolling
  local-neighborhood statistics. No neural network.
- Numeric-variable inference: non-numeric columns are reported back as
  `variablesSkipped`, never silently dropped without explanation.
- Anomaly Context Stability (ACS): seeded, reproducible testing of each
  flagged observation across tested variations in threshold, window,
  normalization method, and row subset (`AnomalyContextStability.ts`).
  Classifies each anomaly as `'stable'` or `'threshold-sensitive'`, always
  paired with a "sensitivity estimate, not a guarantee" disclaimer.
- Unit tests covering: normal data, known injected anomalies, a MAD test,
  a robust-Z-score test, an IQR test, a rolling test, a stability test
  (both a stable and a genuine threshold-sensitive case), missing values,
  empty/invalid input, single-row data, small datasets, and a larger
  (300-row, 3-variable) synthetic dataset. Deterministic output is
  verified directly.
- Runnable example (`examples/basic-usage.mjs`).
- `model.json` manifest, Apache-2.0 `LICENSE`, `SECURITY.md`,
  `CONTRIBUTING.md`.

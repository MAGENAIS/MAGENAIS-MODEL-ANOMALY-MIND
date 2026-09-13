# Contributing to AnomalyMind

Thanks for your interest in contributing.

## Getting started

This package has **zero runtime dependencies** and needs no install step
to develop:

```bash
git clone https://github.com/MAGENAIS/MAGENAIS-MODEL-ANOMALY-MIND.git
cd MAGENAIS-MODEL-ANOMALY-MIND
npm test          # node --experimental-strip-types --test tests/*.test.ts
npm run example   # runs examples/basic-usage.mjs
```

Requires Node.js >= 22 (for `--experimental-strip-types`).

## Project layout

```
src/
  contract.ts                  Model/ModelManifest/ModelRequest/ModelResponse shapes
  types.ts                     AnomalyMind-specific input/output types
  AnomalyMindAlgorithm.ts       Validation, numeric-variable inference, MAD/robust-Z/IQR/rolling scoring
  AnomalyContextStability.ts   Anomaly Context Stability (ACS): seeded configuration/subset testing
  AnomalyMindModel.ts          Wraps the algorithm behind the Model interface
  index.ts                     Public exports
tests/                          node:test unit tests
examples/                       Runnable usage examples
docs/                           Algorithm background and research notes
```

## Ground rules

- **No runtime dependencies.** This package intentionally stays
  dependency-free. If a contribution needs one, open an issue to discuss
  first.
- **No neural network / heavy model.** MASTER PROMPT §10 scopes AnomalyMind
  to lightweight, explainable statistical methods only (MAD, robust
  Z-score, IQR, rolling statistics). A neural or ML-based detector belongs
  in a different, separately named model, not folded into this one.
- **Determinism matters.** Anything involving randomness (currently only
  ACS's configuration/subset sampling) must go through the seeded PRNG in
  `AnomalyContextStability.ts`, never `Math.random()` directly, so results
  stay reproducible for a given input + seed.
- **No TypeScript constructor parameter properties**
  (`constructor(private readonly x: T)`). The test runner uses Node's
  `--experimental-strip-types`, which does not support that syntax. Use a
  plain field declaration + assignment in the constructor body instead.
- **Keep `src/contract.ts` in sync** with the shared schema published in
  the `MAGENAIS-MODELS` catalog repository
  (`schemas/model-manifest.schema.json`, `schemas/model-response.schema.json`).
  If you need to change the contract shape, propose it there first.
- **Every algorithm change needs a test.** In particular, changes to any
  of the four detection methods' scoring or to ACS should include a test
  with a known/expected result (a known injected anomaly, a known
  non-anomaly), not just "it doesn't throw."
- **Keep the ACS disclaimer.** Any change touching `AnomalyContextStability.ts`
  or `AnomalyMindModel.ts` must keep the "sensitivity estimate, not a
  guarantee" disclaimer (`CONTEXT_STABILITY_DISCLAIMER`) in the model's
  warnings — never present ACS as a certainty.
- **Export each name from exactly one file in `index.ts`.** A name
  (`export const X` / `export function X`) may only be exported once
  across the files `index.ts` re-exports via `export *`. Two files
  exporting the same name causes an ambiguous re-export (`tsc` error
  TS2308) that silently breaks the build the first time someone actually
  runs `tsc` against it — see the MAGENAIS repository's
  `PHASE-9-BUILD-FIX.md` for a real example of this happening.
- **No novelty overclaiming.** Please don't describe ACS as "the first" or
  "unprecedented" in docs or commit messages — see the "Research
  direction" section of `README.md`.

## Reporting bugs / requesting features

Open a GitHub issue with:

- the input that produced the unexpected result (or the feature request),
- what you expected vs. what happened,
- the package version.

## Pull requests

1. Fork and branch from `main`.
2. Add/update tests for your change.
3. Run `npm test` — it must pass with zero failures.
4. Update `CHANGELOG.md` under an "Unreleased" heading.
5. Open a PR describing the change and why it's needed.

## Code of Conduct

Be respectful and constructive. Disagreements about approach are fine and
expected in a research-oriented project; personal attacks are not.

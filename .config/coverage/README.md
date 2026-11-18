# Cumulative coverage

Collect unit, integration and E2E suites as separate receipts. Merge successful runs and shards for the **same platform, architecture, Node version and source snapshot**, then enforce the threshold. Repeated execution contributes hits to the same source locations, never additional denominator lines. A strong platform cannot compensate for another platform.

Pin development dependencies `c8@12.0.0` and `istanbul-lib-coverage@3.2.2`. Configure `.config/coverage.json` with `include`, `exclude`, `platformExclude` and `threshold` (98). Exclude only non-executable declarations, generated files, and code exclusive to other platforms; never exclude error handling to meet a target.

```sh
node .config/coverage/collect.mts --run=attempt-1 --suite=unit --shard=1 -- node --test test/unit/*.test.mts
node .config/coverage/collect.mts --run=attempt-1 --suite=integration --shard=1 -- node --test test/integration/*.test.mts
node .config/coverage/gate.mts coverage-plan.json
```

Each immutable receipt lives under `.cache/coverage/<platform>-<arch>/<run>/<suite>/<shard>/receipt.json`. A retry needs a new run name. List every expected receipt in a plan:

```json
{
  "receipts": [
    ".cache/coverage/linux-x64/attempt-1/unit/1/receipt.json",
    ".cache/coverage/linux-x64/attempt-1/integration/1/receipt.json"
  ],
  "expected": ["attempt-1/unit/1", "attempt-1/integration/1"]
}
```

Reports with missing sources/shards, mismatched source hashes, failed tests, duplicate identities or mixed platforms are rejected. The combined report and measured SVG badges are written to `.cache/coverage/<platform>-<arch>/combined/`. Gates compare unrounded line and branch percentages. Keep native C++ coverage as a separate required lane; JavaScript coverage does not measure native machine code.

## Inline GitHub Actions

Adopt `workflow/native-coverage` with `vowen inline workflow/native-coverage --apply`. It installs a repository-owned `.github/workflows/ci.yml` and the coverage collector/gate. Review an existing workflow before replacing it; Vowen reports conflicts rather than overwriting local work.

The workflow uses only inline `run` steps, Git, the runner's existing Node bootstrap, and the repository's pinned toolchain. It has no `uses:` actions or additional package dependencies. Node archives are checked against official SHA-256 manifests. Checkout credentials are scoped to the fetch process, not saved in Git configuration. The tested commit is verified after checkout.

Required scripts are `check` and `test:integration`. If `build:windows-helper` exists, Windows first runs `test/src/windows.test.mts` without the helper, then builds it before the complete tests. Customize that optional block for other projects. Each OS/architecture job independently collects the complete run and gates its cumulative line/branch coverage, including failed or missing evidence. Retry identities include the GitHub run attempt.

Results appear in job logs and the job summary. This action-free template does not upload report files or binaries. The V8 gate measures JavaScript/MTS only; native C++ requires a separate instrumented build. The seven runner labels and exact toolchain versions are explicit template inputs to review when adopting or updating.

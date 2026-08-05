# Dependency security maintenance

The repository has no package overrides. Its only custom dependency-resolution
rules are the two `patchedDependencies` below. Repository maintainers own both
patches and must keep their compatibility evidence and removal conditions
current whenever a parent dependency changes.

## Patched dependencies

### `gaxios@6.7.1`

- **Patch:** `patches/gaxios@6.7.1.patch`
- **Rationale:** Replaces `uuid.v4()` with the Bun-compatible Node
  `crypto.randomUUID()` API and removes Gaxios's vulnerable `uuid@9` dependency.
- **Owner:** Repository maintainers.
- **Compatibility tests:** `tests/dependency-patches.test.ts` verifies Gaxios
  multipart boundary generation and a Google Cloud Storage request through the
  patched dependency stack.
- **Removal condition:** Remove the patch only after the resolved Gaxios version
  no longer depends on vulnerable UUID code, either because upstream fixed the
  path or because `@google-cloud/storage` resolves a fixed newer Gaxios release.
  Regenerate `bun.lock` and complete every required check below before removal.

### `teeny-request@9.0.0`

- **Patch:** `patches/teeny-request@9.0.0.patch`
- **Rationale:** Replaces `uuid.v4()` with the Bun-compatible Node
  `crypto.randomUUID()` API and removes teeny-request's vulnerable `uuid@9`
  dependency.
- **Owner:** Repository maintainers.
- **Compatibility tests:** `tests/dependency-patches.test.ts` verifies callback
  multipart boundary generation and the Google Cloud Storage request path.
- **Removal condition:** Remove the patch only after the resolved teeny-request
  version no longer depends on vulnerable UUID code, either because upstream
  fixed the path or because `@google-cloud/storage` no longer resolves
  teeny-request 9.0.0. Regenerate `bun.lock` and complete every required check
  below before removal.

The Docker build must copy `patches/` before running
`bun install --frozen-lockfile --production`; otherwise the production install
cannot apply the patches. CI and Docker both use Bun 1.3.9 so lockfile and patch
behavior match.

## Required checks

Run all checks after changing either patch, `patchedDependencies`, `bun.lock`, or
a parent dependency:

```bash
bun install --frozen-lockfile
bun test tests/dependency-patches.test.ts tests/trading-day.test.ts
bun run typecheck
bun run knip
trunk check --all --filter=osv-scanner
docker build -t morning-briefing:dependency-check .
```

Every command must exit successfully. Knip and OSV Scanner must each report zero
findings, and the dependency patch tests must pass without skips. Do not replace
a patch with an ignore, baseline, or suppression.

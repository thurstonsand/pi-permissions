---
name: npm-release
description: Prepare, tag, publish, and verify an npm release for this repo. Use when the user wants to release pi-permissions to npm.
---

# npm Release

Use this skill when preparing and publishing a new release for `pi-permissions`.

## Release model

- Release from `main` with `mise run release X.Y.Z`; `docs/release.md` describes what it checks and does.
- npm publishing is tag-driven through `.github/workflows/release.yml`, which refuses a tag that disagrees with `package.json` or the newest `CHANGELOG.md` section.
- `CHANGELOG.md` holds the human release notes: `## [Unreleased]`, then `## [x.y.z] - YYYY-MM-DD` sections, newest first. Pi shows them to users after an update.
- The annotated tag body is the release's `CHANGELOG.md` section, which the task extracts.
- Stable releases are `vX.Y.Z` tags.
- Stable package tags are immutable. Never force-push a stable release tag.
- The GitHub Action uses npm Trusted Publishing through OIDC.
- The `downgrade` branch tracks `main` with specific downgrades needed for a limited environment.

## 1. Inspect release state

- Check the current git state before touching anything. If the working tree has unrelated changes, leave them alone. If release-relevant changes are uncommitted, ask whether they belong in the release before proceeding.
- Inspect changes since the latest stable tag
- Summarize:
  - user-facing features and fixes
  - package, install, or release changes
  - API changes
  - documentation updates
  - likely semver bump: patch, minor, or major

Ask the user to confirm the target version unless they already specified it.

## 2. Review the release notes

Review the entries under `## [Unreleased]` in `CHANGELOG.md` against the changes since the latest tag, and edit them until they describe what ships:

```md
## [Unreleased]

Short release summary.

### Added

- User-facing change.

### Changed

- Package or install change.

### Fixed

- User-facing fix.
```

Omit empty sections. Do not list every internal refactor. If the user edits the notes, preserve their wording. Leave the heading as `## [Unreleased]`; the release task dates it.

If release mechanics change, update `docs/release.md`.

## 3. Verify locally

Run the full gate and inspect package contents:

```sh
mise run check
npm pack --dry-run
```

Do not proceed on failures. Fix them or report the blocker.

## 4. Push the notes

Commit the reviewed notes, push `main`, and wait for its CI to pass. If hooks modify staged files, the commit will fail; resolve the hook, then recommit.

## 5. Run the release task

```sh
mise run release X.Y.Z
```

It refuses when `main` is dirty, behind or ahead of `origin`, without green CI, has nothing under `## [Unreleased]`, or `X.Y.Z` is not newer than `package.json`'s version. Fix the cause it names rather than working around it. Otherwise it commits `chore(release): X.Y.Z`, tags `vX.Y.Z`, and pushes both. Do not create or force-push the tag by hand.

## 6. Watch GitHub Actions publishing

The tag should trigger the Release workflow.

- Use the `gh` tool to find the release (`gh run list --workflow Release`)
- Watch the release action to completion
- The workflow should check that the versions agree, run CI, and publish to npm with the `latest` dist-tag.
- If there is an error, inform the user what went wrong, including a proposed fix when feasible.

## 7. Final verification

Confirm npm and git remote state:

```sh
VERSION=X.Y.Z
npm view @thurstonsand/pi-permissions version dist-tags --json
git ls-remote --tags origin "v${VERSION}"
git status --short
```

## 8. Rebase the `downgrade` branch

The `downgrade` install resets to the branch tip, so it stays on the previous version until the branch carries the release. Load the `downgrade-rebase` skill and follow it with `v${VERSION}` as the target.

## 9. Final report

Final report should include:

- npm version published
- release commit hash and tag
- workflow watched and whether it passed
- verification status
- the `downgrade-rebase` report: new `downgrade` commit, pin confirmation, and any pins now due for recheck
- any follow-up work or issues encountered

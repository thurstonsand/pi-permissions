---
name: downgrade-rebase
description: Rebase the `downgrade` branch onto `main` or a release tag and prove every pin in `PINS.md` survived. Use after a release, in a maintenance round that moved `main`, or whenever `downgrade` is behind `main`.
---

# Downgrade Rebase

The `downgrade` branch is `main` plus pins for an environment whose registry mirror lags npm. It installs with `pi install git:github.com/thurstonsand/pi-permissions@downgrade`, and `pi update` hard-resets that clone to the branch tip, so the branch must carry whatever `main` ships or that install falls behind.

The job of this skill is to stop pins from disappearing silently. Git can merge `package.json` cleanly and still drop a pin, and a regenerated lockfile can quietly nest a newer copy of a pinned package. Neither shows up as a conflict, so every pin is re-checked after every rebase, conflict or not.

## Model

- **One pin commit.** The branch is a single pin commit on top of `main`. Amend it when pins change instead of stacking commits, so the diff against `main` is the whole story.
- **Force-push is correct.** Pi resets rather than pulls, so rewritten history costs the downstream install nothing.
- **`PINS.md` is the contract.** Every row is a pin that must hold after the rebase. Each pin is enforced one of three ways:
  - **Exact range**: a direct dependency whose `package.json` range is narrowed to the pinned version. Needed once `main`'s range stops admitting it.
  - **Override**: a transitive dependency with an `overrides` entry in `package.json`.
  - **Lockfile-only**: nothing in `package.json` enforces it; only the lockfile holds it. That covers a transitive dependency with no `overrides` entry and a direct dependency whose range still admits newer versions, such as `^1.61.0` holding `1.61.0`. Regenerating the lockfile loses it every time, so prefer moving it to one of the other two.

## Workflow

### 1. Rebase

The target is the release tag (`v${VERSION}`) after a release, otherwise `origin/main`.

Find where the branch is checked out with `git worktree list`. If nothing has it and the request does not say how to proceed, ask rather than choosing — create a worktree, and where, or switch the main worktree to the branch and back afterward.

```sh
TARGET=origin/main # or "v${VERSION}"
git fetch origin
git rebase "$TARGET"
```

Never merge a lockfile conflict by hand. Take the target's lockfile whole; step 3 rebuilds the pins on top of it:

```sh
git show "$TARGET":package-lock.json > package-lock.json
```

For a `package.json` conflict, take the target's lines, then re-apply the pin in step 2.

Done when the rebase is either stopped on the pin commit with `package-lock.json` replaced by the target's, or finished cleanly.

### 2. Re-check pins in `package.json`

Do this even when the rebase reported no conflict. For each `PINS.md` row:

```sh
jq '{dependencies, devDependencies, overrides}' package.json
git show "$TARGET":package.json | jq '{dependencies, devDependencies}'
```

- **Exact range**: the range is exactly the pinned version. A clean merge takes `main`'s new range whenever `main` bumped that line and the pin commit did not touch it, which drops the pin without a conflict.
- **Override**: `overrides` holds the pinned version.
- **Direct pin without a narrowed range**: if `main`'s range no longer admits the pinned version, narrow it to exact now. A direct dependency cannot take an `overrides` entry.

Done when every row enforced in `package.json` matches its pinned version.

### 3. Regenerate the lockfile

Start from the target's lockfile (step 1) and let npm apply the pins:

```sh
npm install --package-lock-only --ignore-scripts
npm dedupe --package-lock-only
```

The dedupe matters for direct pins: a fresh install can leave a newer copy of the pinned package nested under a transitive dependent, which `npm ls` accepts as a second version and the mirror cannot serve.

Then restore each lockfile-only pin. Installing it rewrites its range in `package.json`, so put `package.json` back and re-sync:

```sh
cp package.json /tmp/package.json.pinned
npm install --package-lock-only --ignore-scripts "<pkg>@<version>"
cp /tmp/package.json.pinned package.json
npm install --package-lock-only --ignore-scripts
```

Done when the lockfile is regenerated and `git diff "$TARGET" -- package-lock.json` changes only pinned packages and their own dependencies.

### 4. Confirm every pin

```sh
npm ci
npm ls <pkg> --all
```

Run `npm ls` for every `PINS.md` row. Each must show only the pinned version — `overridden` and `deduped` are fine, any other version anywhere in the tree is not. If a lockfile-only pin keeps a nested copy, the lockfile cannot hold it; move it to an override or an exact range and repeat from step 3.

Done when every row shows the pinned version and nothing else.

### 5. Update `PINS.md`

Confirm each row's `main` wants column describes what the target actually resolves to, by range and resolved version, or by the dependent that pulls it in. It drifts every time a range or a transitive resolution moves, and a stale column hides a pin that is now doing more work than it was meant to.

Then check the `Recheck after` dates. Do not silently rebase past a passed date: report which pins are due, so the user can retest the unpinned version in the constrained environment with `npm view <pkg> versions` against the mirror. They either drop the pin or renew it.

Set `Recheck after` two months out whenever a pin is added or renewed. Long enough that it does not nag at every rebase, short enough that a mirror catching up gets noticed while the version gap is still small.

Done when every column is accurate and any due pins are noted for the report.

### 6. Verify and push

```sh
git add -A
GIT_EDITOR=true git rebase --continue # or git commit --amend --no-edit after a clean rebase that needed changes
mise run check
git status --short
git push --force-with-lease=downgrade:origin/downgrade origin downgrade
```

`git status` must be clean after `mise run check`; the bootstrap hook reinstalls dependencies and would surface a lockfile that drifted.

Done when the gate passes and the push lands.

### 7. Report

Report the new `downgrade` commit, the target it was rebased onto, the `npm ls` result for every pin, any pin that had to be re-applied or moved, and any pins past their recheck date.

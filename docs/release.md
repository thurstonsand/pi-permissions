# Release

`@thurstonsand/pi-permissions` publishes to npm from GitHub Actions when a stable `v*` tag is pushed.

## Changelog

`CHANGELOG.md` opens with `## [Unreleased]`, followed by `## [x.y.z] - YYYY-MM-DD` sections, newest first. Pi shows the sections newer than the version a user last saw after they update, so `package.json` on `main` always carries the version of the newest section. `mise run lint:changelog`, part of `mise run check`, fails when a heading does not match, versions do not strictly descend, or the newest section is not `package.json`'s version.

## Release flow

1. Add entries under `## [Unreleased]` as changes land, and review them before releasing.
2. Push `main` and wait for CI to pass.
3. Run `mise run release X.Y.Z`. It refuses unless you are on a clean `main` that matches `origin/main` with green CI, `## [Unreleased]` has entries, and `X.Y.Z` is newer than `package.json`'s version. It then moves the entries under `## [X.Y.Z] - <today>`, writes `X.Y.Z` into `package.json` and `package-lock.json`, commits `chore(release): X.Y.Z`, tags `vX.Y.Z` with that section as the body, and pushes `main` and the tag.
4. The `Release` workflow checks that the tag, `package.json`, and the newest changelog section agree, runs CI, packs the package, and publishes it to npm with the `latest` dist-tag and provenance.

## Release note extraction

`scripts/extract-release-notes.sh vX.Y.Z` prints the `## [X.Y.Z]` section that the release task uses as the tag body.

#!/usr/bin/env bash
# usage: release.sh x.y.z
#
# Moves CHANGELOG.md's Unreleased entries under x.y.z, writes x.y.z into package.json and the
# lockfile, commits, tags vx.y.z with that section, and pushes main and the tag. The Release
# workflow publishes from the tag.
set -euo pipefail

version="${1:?usage: release.sh x.y.z}"
tag="v${version}"

fail() {
  echo "release: $*" >&2
  exit 1
}

[[ "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "${version} is not x.y.z"

[[ "$(git rev-parse --abbrev-ref HEAD)" == "main" ]] || fail "not on main"
[[ -z "$(git status --porcelain)" ]] || fail "the working tree is not clean"
git fetch --quiet origin main --tags
head="$(git rev-parse HEAD)"
[[ "${head}" == "$(git rev-parse origin/main)" ]] || fail "main does not match origin/main"
! git rev-parse --quiet --verify "refs/tags/${tag}" >/dev/null || fail "${tag} already exists"

ci="$(gh run list --workflow ci.yml --commit "${head}" --limit 1 --json status,conclusion \
  --jq '.[0] // empty | "\(.status)/\(.conclusion)"')"
[[ "${ci}" == "completed/success" ]] || fail "CI on ${head} is not green (${ci:-no run})"

current="$(node -p 'require("./package.json").version')"
[[ "${version}" != "${current}" && "$(printf '%s\n%s\n' "${current}" "${version}" | sort -V | tail -1)" == "${version}" ]] ||
  fail "${version} is not greater than ${current}"

unreleased="$(awk '/^## \[Unreleased\]$/ { found = 1; next } found && /^## / { exit } found && NF' CHANGELOG.md)"
[[ -n "${unreleased}" ]] || fail "CHANGELOG.md has nothing under ## [Unreleased]"

today="$(date +%F)"
awk -v heading="## [${version}] - ${today}" \
  '{ print } $0 == "## [Unreleased]" { print ""; print heading }' CHANGELOG.md >CHANGELOG.md.next
mv CHANGELOG.md.next CHANGELOG.md
npm version "${version}" --no-git-tag-version >/dev/null
node scripts/check-changelog.mjs "${version}"

notes="$(mktemp)"
trap 'rm -f "${notes}"' EXIT
scripts/extract-release-notes.sh "${tag}" >"${notes}"

git add CHANGELOG.md package.json package-lock.json
git commit --quiet -m "chore(release): ${version}"
git tag -a "${tag}" --cleanup=verbatim -F "${notes}"
git push --atomic origin main "${tag}"

echo "release: pushed ${tag}; the Release workflow publishes it"

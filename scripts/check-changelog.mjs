#!/usr/bin/env node
// usage: check-changelog.mjs [x.y.z]
//
// Pi shows a package's CHANGELOG.md entries newer than the last version it saw, matching
// headings with /##\s+\[?(\d+)\.(\d+)\.(\d+)\]?/ and comparing them to package.json's version.
// Fails when a heading would not parse, when versions do not strictly descend, or when the top
// released version is not package.json's, or not the version given.
import { readFileSync } from "node:fs";

const RELEASED = /^## \[(\d+)\.(\d+)\.(\d+)\] - \d{4}-\d{2}-\d{2}$/;

const expected = process.argv[2];
const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
const headings = readFileSync("CHANGELOG.md", "utf8")
  .split("\n")
  .filter((line) => line.startsWith("## "));
const errors = [];

if (headings[0] !== "## [Unreleased]") {
  errors.push(`the first heading must be "## [Unreleased]", found ${JSON.stringify(headings[0])}`);
}

let previous;
for (const heading of headings.slice(1)) {
  const match = RELEASED.exec(heading);
  if (!match) {
    errors.push(`${JSON.stringify(heading)} is not "## [x.y.z] - YYYY-MM-DD"`);
    continue;
  }
  const version = match.slice(1, 4).map(Number);
  if (previous && compare(version, previous) >= 0) {
    errors.push(`${version.join(".")} is not older than ${previous.join(".")}, the entry above it`);
  }
  previous = version;
}

const top = RELEASED.exec(headings[1] ?? "")
  ?.slice(1, 4)
  .join(".");
if (top !== packageVersion) {
  errors.push(`the top released version is ${top}, but package.json says ${packageVersion}`);
}
if (expected !== undefined && top !== expected) {
  errors.push(`the top released version is ${top}, but ${expected} is being released`);
}

if (errors.length > 0) {
  for (const error of errors) console.error(`CHANGELOG.md: ${error}`);
  process.exit(1);
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

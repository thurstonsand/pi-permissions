# Package-bundled permissions

## Status

Accepted

## Decision Summary

`pi-permissions` will load permission modules bundled by Pi packages, using package discovery and filtering semantics that mirror Pi's package resource model as closely as the extension boundary allows. Package-level permissions run after explicit project-level and user-level permissions, trading earlier package enforcement for clearer local override precedence.

## Problem Statement / Background

Pi packages can already bundle extensions, skills, prompts, and themes through `package.json` `pi` metadata and package filters. A package that provides an extension may also know which tool-use actions deserve workflow gates, but today those permissions must be installed separately under `.pi/permissions` or `~/.pi/agent/permissions`.

This creates a split packaging story. An author can ship an extension and its skill assets together, but cannot ship the associated `pi-permissions` hooks as part of the same package. The approver must either copy separate permission modules manually or accept that installing the extension does not install its intended workflow gates.

Concrete scenario: a package provides a custom deployment extension. The extension itself registers commands and tools, while its permission module requests approval before deploying production or editing generated deployment manifests. Those permission hooks should be installable with the package, but the approver should still be able to keep the extension while disabling those permissions through the same package filter shape Pi already uses for other resources.

## Goals

- Let Pi packages provide permission modules as package-level resources.
- Reuse Pi's exported package resolution machinery wherever possible instead of creating an independent package model.
- Support Pi-compatible package filtering for package-level permissions.
- Preserve clear permission precedence: explicit project-level and user-level permissions run before package-level permissions.
- Keep permission loading modular so each source returns hooks and load errors without owning reporting or runtime mutation.

## Non-Goals

- Change Pi core or require Pi to understand `pi.permissions`.
- Add a new permission decision type such as explicit allow.
- Couple package-level permissions to whether package extensions are enabled.
- Guarantee isolation from permission module side effects. Permission modules remain trusted TypeScript loaded by the local process, like extensions.

## Exposed Shape

A Pi package may declare permission resources in `package.json`:

```json
{
  "pi": {
    "extensions": ["./extensions/index.ts"],
    "permissions": ["./permissions/index.ts"]
  }
}
```

If a package has no explicit `pi` manifest entry for permissions, `pi-permissions` also supports the package convention directory:

```text
permissions/
```

Package settings may filter permission resources using the same style Pi uses for extensions, skills, prompts, and themes:

```json
{
  "packages": [
    {
      "source": "npm:some-pi-extension",
      "permissions": []
    }
  ]
}
```

The `permissions` package filter supports normal include patterns, `!` excludes, `+` force-includes, and `-` force-excludes. An omitted `permissions` key loads the package default permissions. An empty array disables package-level permissions for that package.

Loaded hooks and load errors carry source metadata:

```ts
type PermissionSource = "project" | "user" | `package:${string}`;
```

Package source strings use the same source string Pi settings use, prefixed with `package:` for disambiguation.

## Design Decisions

### 1. Package-level permissions are a package resource

Package-level permissions are modeled alongside Pi package resources rather than as an attribute of extensions. A package may provide permissions with extensions, without extensions, or with extensions filtered out.

The tradeoff is that the feature is broader than "permissions bundled with an extension." That breadth is intentional. Pi packages are the distribution unit; extensions are one resource type inside that unit. Treating permissions as a peer resource keeps filtering predictable and avoids special coupling rules.

### 2. Package discovery follows Pi package resolution and dedupe

`pi-permissions` should use Pi's exported package manager and settings manager to resolve configured packages. Project package settings participate only when the project is trusted, matching Pi's own trust boundary. If the same package is configured at project and user scope, Pi's normal dedupe semantics apply and the project package entry wins.

This avoids a parallel package resolver. The extension still needs its own permission-resource collection because Pi's internal resource collection helpers are private and Pi does not know about `permissions` as a resource type.

### 3. Package-level permissions run after explicit project and user permissions

The evaluation order becomes:

1. project-level permissions from `.pi/permissions`
2. user-level permissions from `~/.pi/agent/permissions`
3. package-level permissions from configured Pi packages

This gives explicit local permission modules the first chance to block or request approval. Package-level permissions become bundled defaults rather than higher-precedence policy. The cost is that a package-provided request may not appear if an earlier project or user hook already decides the tool call, but that follows the existing terminal decision model.

### 4. Package filters mirror Pi's resource filter semantics

The package filter key `permissions` uses the same meanings as Pi's package filters for extensions, skills, prompts, and themes:

- omitted key: load package defaults
- `[]`: disable all permissions from that package
- plain patterns: include matching resources
- `!pattern`: exclude matching resources
- `+path`: force-include an exact path
- `-path`: force-exclude an exact path

The tradeoff is a small local reimplementation of Pi's private filtering helpers. The benefit is that authors and approvers do not need a new filtering language for permissions.

### 5. Convention directory support is allowed

When a package has no explicit `pi.permissions` manifest entry, `pi-permissions` will discover permission modules from a top-level `permissions/` directory. This mirrors Pi's convention-directory package behavior for known resources.

This can surprise package authors if a package contains a `permissions/` directory that was not intended for `pi-permissions`. The design accepts that risk for consistency with Pi package conventions. An approver can disable the resource with `permissions: []`.

### 6. Loaders return data; aggregation owns reporting

Each permission source loader returns hooks and errors. Loaders do not notify the UI or mutate runtime state. The runtime aggregator preserves source precedence, combines results, stores hooks, and reports load errors.

This keeps loading modular and makes parallel loading possible without depending on completion order. Permission modules are still trusted code and may have side effects, but the `pi-permissions` loading infrastructure should not introduce additional side effects.

## Edge Cases & Failure Modes

- **Project is not trusted:** Project-level permissions and project package-level permissions are not loaded. User-level permissions and user package-level permissions may still load.
- **Package is configured but not installed:** `pi-permissions` does not install missing packages. Pi owns package installation; missing packages are skipped or reported according to the chosen package-manager call path.
- **Package declares `pi.permissions` and has a `permissions/` directory:** Explicit manifest entries win; convention discovery is used only when the manifest does not declare permissions.
- **Package filter sets `permissions: []`:** No permission modules from that package are loaded.
- **Package filter references no matching permissions:** No permission modules are loaded from that package; this is not itself a load error.
- **Permission module path does not exist:** Loading continues and returns a `PermissionLoadError` with the module path and permission source.
- **Permission module fails to load or does not default-export a function:** Loading continues and returns a `PermissionLoadError` with the module path and permission source.
- **The same package is configured at project and user scope:** Pi-style dedupe applies; the project package entry wins.
- **A package permission hook is blocked by earlier precedence:** Earlier project or user terminal decisions stop evaluation before package hooks run, matching the existing decision model.

## Alternatives

### Require explicit `pi.permissions` only

- **Status:** Rejected
- **Decision:** This would reduce surprise but diverge from Pi's convention-directory package behavior.
- **Retained discussion:** The concern remains valid: convention discovery can activate permissions from a package that did not explicitly opt into `pi.permissions`. Consistency with Pi's package conventions was judged more valuable.

### Couple permissions to enabled extensions

- **Status:** Rejected
- **Decision:** Permissions are package resources, not extension attributes.
- **Retained discussion:** The original motivating phrase was "permissions with a different extension," but Pi packages are the distribution boundary. Coupling to extension enablement would make permissions-only packages awkward and create special cases when a package ships multiple resource types.

### Load package-level permissions before user-level permissions

- **Status:** Rejected
- **Decision:** Package-level permissions should behave as bundled defaults, not local policy overrides.
- **Retained discussion:** Loading package permissions earlier might surface package-specific prompts sooner, but it would make explicit user-level permissions less authoritative.

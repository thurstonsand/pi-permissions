# Permission Package Layout

Read the branch that applies to the policy brief.

## Permission bundled by a Pi package

Put the module under the package's `permissions/` directory. A package with an explicit Pi manifest should declare its permission files alongside its other resources:

```json
{
  "pi": {
    "extensions": ["./extensions/index.ts"],
    "skills": ["./skills"],
    "permissions": ["./permissions/index.ts"]
  }
}
```

If `pi.permissions` is omitted, `pi-permissions` checks the top-level `permissions/` convention directory. An explicit declaration is clearer when the manifest already enumerates resources.

Inspect package publication rules such as npm's `files` field and verify the permission module appears in the packed artifact. Package settings can narrow bundled permissions with include and exclude patterns; an empty `permissions` array disables them.

Add any approved third-party dependency to the owning Pi package's runtime `dependencies`.

## User or project permission with a third-party dependency

Top-level permission files do not own arbitrary third-party dependencies. Give the policy its own package directory:

```text
permissions/
└── policy-name/
    ├── package.json
    ├── package-lock.json
    ├── node_modules/
    └── index.ts
```

For user scope, `permissions/` above is `~/.pi/agent/permissions/`. For project scope, it is `.pi/permissions/`.

```json
{
  "private": true,
  "type": "module",
  "dependencies": {
    "needed-package": "^1.0.0"
  },
  "pi": {
    "permissions": ["./index.ts"]
  }
}
```

Install dependencies inside that directory. Keep the dependency and lockfile owned by this package so loading does not rely on accidental resolution through the current project or Pi installation.

## Available without package machinery

A top-level `.ts` module can import:

- `@thurstonsand/pi-permissions`
- Node built-ins through `node:*`
- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-ai`, `@earendil-works/pi-ai/compat`, and `@earendil-works/pi-ai/oauth`
- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-tui`
- `typebox`, `typebox/compile`, and `typebox/value`, including the `@sinclair/typebox` aliases

Jiti handles TypeScript loading. The public `parseShellCommand()` and `matchCommand()` helpers already own the extension's shell-parser dependencies.

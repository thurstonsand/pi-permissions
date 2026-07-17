---
name: create-permission
description: Create a pi-permissions module for a pi tool call that should require approval or be blocked.
disable-model-invocation: true
---

# Create Permission

## What pi-permissions is

Pi agents act through tools: they run shell commands, read or edit files, and call tools supplied by extensions. `pi-permissions` adds a decision point immediately before one of those tool calls executes.

Permission authors write small TypeScript modules that inspect a proposed tool call. A module may:

- return nothing and let evaluation continue
- pause and ask the person running Pi whether the call should proceed
- block the call with a reason for the agent

This supports deliberate workflow boundaries—reviewing commits, protecting generated files, checking deployments. TypeScript keeps the policy open-ended instead of forcing every workflow into a fixed rule language.

## Terms used below

- **Approver:** the person running the Pi session. They see permission prompts and approve, edit, or reject requested tool calls.
- **Tool call:** one action the agent proposes through a Pi tool, including its input: a bash command, file path, or custom-tool payload.
- **Permission module:** a TypeScript file loaded by `pi-permissions`. Its default export registers permission hooks.
- **Permission hook:** one named, independently toggleable check that inspects a tool call and may return a decision.
- **Pi package:** an installable bundle of Pi resources, such as extensions and skills, that may also ship permission modules.
- **Request prompt:** the message shown to the Approver when a hook asks before execution.
- **Highlight:** visual emphasis applied to the relevant fragment of the tool detail in a request prompt—for example, `git push` within a longer shell command.

## The SDK at a glance

A permission module registers hooks through `api.onToolUse()`:

```ts
export default function permissions(api: PermissionsAPI) {
  api.onToolUse({
    name: "production deploy",
    description: "Ask before deploying to production.",
    handler(input) {
      // Inspect the proposed tool call and optionally return a decision.
    },
  });
}
```

The main building blocks are:

- **Normalized tool input:** `input.tool` identifies the tool and exposes convenient fields such as a bash `command` or a file's resolved path. `input.cwd` identifies the active project, while `input.permissionRoot` identifies the root assigned to the permission module or package.
- **Tool matching:** `matchTool()` branches cleanly across bash, file, and custom tools. Narrowing helpers support direct branching when that reads better.
- **Shell matching:** `matchCommand()` handles common program/subcommand policies. `parseShellCommand()` exposes parsed commands, arguments, flags, and source spans for structural checks.
- **Decisions:** `request()` pauses for the Approver. `block()` stops the call. Returning `undefined` means this hook does not decide, so the next hook may evaluate it.
- **Prompt presentation:** a request may add guidance, customize action labels, and highlight the evidence that caused the prompt.

Handlers are ordinary TypeScript and may combine these helpers with custom logic. The SDK supplies normalization, shell parsing, decisions, and prompt controls; the permission's author supplies the workflow policy.

Read the [core permission API reference](references/permission-api.md) for the exact module and tool contracts. Bash policies also use the [shell matching reference](references/bash-matching.md). Package-bundled permissions and approved third-party dependencies use the [package layout reference](references/package-layout.md).

## What this skill does

Use this skill when someone can describe a desired workflow boundary but does not want to design the module against the SDK by hand. It turns that plain-language request into a precise policy, writes the permission at the correct scope, builds safe examples, and proves the behavior through Pi after reload.

The process begins by inspecting the current environment. It asks only questions whose answers materially change behavior; obvious choices are inferred and reported.

## 1. Resolve the policy brief

Inspect the current project, its instructions, existing permission modules, and package manifest before asking questions. Infer decisions already made by the request or repository. Ask the user one grouped set of questions only for unresolved choices that change behavior.

Resolve every field in this **policy brief**:

- **Scope:** where the permission should apply—this user, this project, or a reusable Pi package
- **Decision:** whether a matching call requests approval or is blocked outright
- **Trigger:** which tools and exact input conditions cause that decision
- **Near misses:** similar calls that must continue without this hook deciding
- **Prompt:** the hook name, explanation, call-specific guidance (if any), and any custom action labels
- **Highlight:** which fragment of the displayed tool detail best explains why the request appeared
- **Dependencies:** whether the built-in SDK is sufficient or an approved third-party package is necessary

Choose scope with this tree:

1. If the permission belongs to behavior shipped by a Pi package being authored, use package scope.
2. If it expresses policy for the current repository or team, use project scope.
3. If it expresses the user's workflow across projects, use user scope.
4. If more than one remains plausible, ask the user.

Choose the decision deliberately: use `block()` when execution should never be offered and `request()` when the Approver may reasonably proceed after review.

Choose the highlight as the **smallest complete evidence**, not automatically the shortest match:

1. Highlight the program and subcommand—for example, `git push`—when they alone explain the trigger.
2. Highlight each whole offending command invocation when its flags, arguments, or target complete the evidence.
3. Highlight only the specific arguments or path fragments when those are what offend.
4. Use custom selection logic when repeated text or computed conditions make a simple pattern ambiguous.
5. Omit the highlight when the rendered detail is already short and no fragment is more informative than the whole.

A permission defaults to one dependency-free TypeScript file. The loader already provides TypeScript, Node built-ins, the public `pi-permissions` API, Pi's core packages, and TypeBox; the shell helpers include their parser dependencies. If the policy genuinely requires another package, explain why and get explicit approval before adding it or creating dependency-owning package machinery.

The brief is complete when every field is resolved and the user has approved any third-party dependency.

## 2. Implement the permission

Read the [core permission API reference](references/permission-api.md) completely before writing code. If the trigger includes bash, also read [bash matching](references/bash-matching.md) completely. If the scope is package-level or the user approved a third-party dependency, also read [permission package layout](references/package-layout.md) completely.

Prefer one hook per independently toggleable behavior. Match normalized tool input rather than rendered text. For bash, prefer `matchCommand()` or `parseShellCommand()` over raw-command regexes whenever command structure matters.

Place the module according to the brief:

- user: `~/.pi/agent/permissions/<name>.ts`
- project: `.pi/permissions/<name>.ts`
- package: the package's `permissions/` directory, declared through `pi.permissions` when `package.json` contains an explicit `pi` manifest

Preserve existing package manifests, filters, style, and unrelated work. A nonmatching handler returns `undefined` so evaluation continues.

Implementation is complete when every trigger and near miss in the brief maps visibly to code, the permission is independently toggleable at the intended granularity, and no unapproved dependency was added.

## 3. Build the proof

Inspect the finished change and run the formatter, typechecker, or tests provided by the owning project when they cover the changed files.

Build a smoke matrix containing:

- one case for every distinct trigger branch
- one near miss for every boundary likely to regress
- the expected decision and highlight for each trigger

The proof is ready when all policy branches are represented by safe cases and pre-reload checks pass, or each unavailable check has a precise reason.

## 4. Reload and test through Pi

Tell the user to run `/reload`, then wait. This skill is not complete at the reload instruction.

After reload:

1. Have the user confirm the hook and intended scope appear in `/permissions`.
2. Issue the safe trigger calls from the smoke matrix and verify the expected request or block. For requests, verify the guidance, labels, and highlight before the user rejects or safely approves.
3. Issue the near misses and verify they run without this hook deciding.
4. Correct the module, reload, and repeat if any observation differs.

Finish with the module path, policy summary, checks run, and observed live results. Explicitly name anything that could not be exercised.

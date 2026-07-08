import { describe, expect, it } from "vitest";
import {
  type CommandMatch,
  gitValueFlags,
  highlightSpans,
  matchCommand,
  parseShellCommand,
  request,
  type SimpleCommand,
} from "../src/index.js";
import type { BashPermissionToolInput } from "../src/tool-input.js";

function bash(command: string): BashPermissionToolInput {
  return { toolName: "bash", input: { command }, detail: command, command };
}

async function parsedCommandAt(command: string, index: number) {
  const parsed = await parseShellCommand(command);
  const simpleCommand = parsed.commands[index];
  if (!simpleCommand) throw new Error(`Expected command at index ${index}`);
  return simpleCommand;
}

describe("parseShellCommand", () => {
  it("keeps quoted command text inert and splits real invocations", async () => {
    const parsed = await parseShellCommand(
      'git status && echo "git add"; command git -C /repo add',
    );

    expect(parsed.commands.map((command) => command.programName)).toEqual(["git", "echo", "git"]);
    expect(
      parsed.commands.map((command) => command.subcommand({ valueFlags: gitValueFlags })?.text),
    ).toEqual(["status", "git add", "add"]);
  });

  it("resolves assignments and wrappers to the effective program", async () => {
    const command = await parsedCommandAt("FOO=1 sudo -u root git push", 0);

    expect(command.assignments.map((token) => token.text)).toEqual(["FOO=1"]);
    expect(command.programName).toBe("git");
    expect(command.subcommand()?.text).toBe("push");
  });

  it("finds commands inside command and process substitutions", async () => {
    const parsed = await parseShellCommand("echo $(git add .) `rm -rf /tmp/x` <(find . -delete)");

    expect(parsed.commands.map((command) => command.programName)).toEqual([
      "echo",
      "git",
      "rm",
      "find",
    ]);
  });

  it("interrogates flags without treating filenames after -- as flags", async () => {
    const parsed = await parseShellCommand("rm -rf /tmp/a; find . -delete; rm -- -rf");
    const rmRecursive = parsed.commands[0];
    const findDelete = parsed.commands[1];
    const rmLiteral = parsed.commands[2];
    if (!rmRecursive || !findDelete || !rmLiteral) throw new Error("Expected three commands");

    expect(rmRecursive.hasFlag("-r", "-R", "--recursive")).toBe(true);
    expect(rmRecursive.hasFlag("-f", "--force")).toBe(true);
    expect(findDelete.hasFlag("-delete")).toBe(true);
    expect(rmLiteral.hasFlag("-r", "-R", "--recursive")).toBe(false);
  });

  it("skips value-taking flags when resolving positionals", async () => {
    const command = await parsedCommandAt("git -C /repo add file", 0);

    expect(command.subcommand({ valueFlags: gitValueFlags })?.text).toBe("add");
    expect(command.positionals({ valueFlags: gitValueFlags }).map((token) => token.text)).toEqual([
      "add",
      "file",
    ]);
  });

  it("parses shell -c payloads when spans map exactly", async () => {
    const parsed = await parseShellCommand("bash -c 'git add .'");
    const git = parsed.commands.find((command) => command.programName === "git");

    expect(git?.subcommand()?.text).toBe("add");
    expect(git?.span).toEqual({ start: 9, end: 18 });
  });

  it("keeps duplicate shell -c payloads at their own offsets", async () => {
    const parsed = await parseShellCommand("bash -c 'git add .' && bash -c 'git add .'");
    const gitCommands = parsed.commands.filter((command) => command.programName === "git");

    expect(gitCommands.map((command) => command.span)).toEqual([
      { start: 9, end: 18 },
      { start: 32, end: 41 },
    ]);
  });

  it("collects nested shell -c payloads exactly once", async () => {
    const parsed = await parseShellCommand(`bash -c "bash -c 'git add .'"`);

    expect(parsed.commands.map((command) => command.programName)).toEqual(["bash", "bash", "git"]);
  });

  it("leaves shell -c payloads opaque when escapes make span mapping unsafe", async () => {
    const parsed = await parseShellCommand('bash -c "git\\" add ."');

    expect(parsed.commands.map((command) => command.programName)).toEqual(["bash"]);
  });

  it("supports wrapper positional skips and wrapper overrides", async () => {
    const timeout = await parsedCommandAt("timeout 5 git push", 0);
    const customWrapper = await parseShellCommand("runner git push", {
      wrappers: [{ program: "runner" }],
    });

    expect(timeout.programName).toBe("git");
    expect(customWrapper.commands[0]?.programName).toBe("git");
  });

  it("handles common value-taking wrappers", async () => {
    const env = await parsedCommandAt("env -u FOO git push", 0);
    const xargs = await parsedCommandAt("xargs -I{} git add {}", 0);

    expect(env.programName).toBe("git");
    expect(xargs.programName).toBe("git");
  });

  it("memoizes the last parse by command and options", async () => {
    const first = await parseShellCommand("git status");
    const second = await parseShellCommand("git status");

    expect(second).toBe(first);
  });

  it("surfaces parse errors without throwing", async () => {
    const parsed = await parseShellCommand("git status && )");

    expect(parsed.hasErrors).toBe(true);
    expect(parsed.commands.some((command) => command.programName === "git")).toBe(true);
  });
});

describe("matchCommand", () => {
  it("matches program and first subcommand with ready-made highlight spans", async () => {
    const decision = await matchCommand({
      program: "git",
      subcommands: ["add"],
      valueFlags: gitValueFlags,
      onMatch: (match) => request({ highlight: match.spans }),
    })(bash("command git -C /repo add"));

    expect(decision?.decision).toBe("request");
    if (decision?.decision !== "request") throw new Error("Expected request decision");
    expect(highlightSpans("command git -C /repo add", decision.prompt?.highlight ?? [])).toEqual([
      { start: 8, end: 11 },
      { start: 21, end: 24 },
    ]);
  });

  it("can match any positional when the author opts into looser matching", async () => {
    const decision = await matchCommand({
      program: ["git", "hub"],
      subcommands: ["add"],
      subcommandPosition: "any",
      onMatch: () => request(),
    })(bash("git log add"));

    expect(decision?.decision).toBe("request");
  });

  it("narrows matches with a where predicate before onMatch fires", async () => {
    const spec = {
      program: ["rm", "find"],
      where: (command: SimpleCommand) =>
        command.programName === "rm"
          ? command.hasFlag("-r", "-R", "--recursive") && command.hasFlag("-f", "--force")
          : command.hasFlag("-delete"),
      onMatch: ({ commands }: CommandMatch) =>
        request({ highlight: commands.map((command) => command.span) }),
    } as const;

    const kept = await matchCommand(spec)(bash("rm -rf build"));
    expect(kept?.decision).toBe("request");
    if (kept?.decision !== "request") throw new Error("Expected request decision");
    expect(highlightSpans("rm -rf build", kept.prompt?.highlight ?? [])).toEqual([
      { start: 0, end: 12 },
    ]);

    const dropped = await matchCommand(spec)(bash("rm build"));
    expect(dropped).toBeUndefined();
  });

  it("requests on parse gaps in strict mode", async () => {
    const decision = await matchCommand({
      program: "git",
      strict: true,
      onMatch: () => undefined,
    })(bash("git status && )"));

    expect(decision?.decision).toBe("request");
  });
});

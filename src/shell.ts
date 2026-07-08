import { createRequire } from "node:module";
import { basename } from "node:path";
import { Language, Parser, type Node as SyntaxNode } from "web-tree-sitter";
import { type PermissionDecision, request } from "./api.js";
import type { HighlightSpan } from "./highlight.js";
import type { BashPermissionToolInput } from "./tool-input.js";

export interface ParseShellCommandOptions {
  wrappers?: readonly WrapperSpec[];
}

export interface WrapperSpec {
  program: string | readonly string[];
  valueFlags?: readonly string[];
  positionalSkips?: number;
}

export interface ParsedShellCommand {
  commands: readonly SimpleCommand[];
  hasErrors: boolean;
}

export interface SimpleCommand {
  program: ShellToken | undefined;
  programName: string | undefined;
  args: readonly ShellToken[];
  assignments: readonly ShellToken[];
  span: HighlightSpan;
  hasFlag(...spellings: readonly string[]): boolean;
  subcommand(options?: TokenWalkOptions): ShellToken | undefined;
  positionals(options?: TokenWalkOptions): readonly ShellToken[];
}

export interface ShellToken extends HighlightSpan {
  text: string;
}

export interface TokenWalkOptions {
  valueFlags?: readonly string[];
}

export interface CommandSpec {
  program: string | readonly string[];
  subcommands?: readonly string[];
  valueFlags?: readonly string[];
  subcommandPosition?: "first" | "any";
  where?: (command: SimpleCommand) => boolean;
  strict?: boolean;
  onMatch: (match: CommandMatch) => PermissionDecision | undefined;
}

export interface CommandMatch {
  commands: readonly SimpleCommand[];
  spans: readonly HighlightSpan[];
}

export const gitValueFlags: readonly string[] = [
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
];

const shellPrograms = new Set(["bash", "sh", "zsh", "dash"]);

const defaultWrappers: readonly WrapperSpec[] = [
  { program: ["command", "exec", "doas", "nohup", "setsid"] },
  {
    program: "sudo",
    valueFlags: [
      "-u",
      "-g",
      "-h",
      "-p",
      "-C",
      "-T",
      "--user",
      "--group",
      "--host",
      "--prompt",
      "--close-from",
      "--command-timeout",
    ],
  },
  {
    program: "env",
    valueFlags: [
      "-i",
      "-0",
      "--ignore-environment",
      "--null",
      "--unset",
      "-u",
      "--chdir",
      "-C",
      "--split-string",
      "-S",
    ],
  },
  { program: "nice", valueFlags: ["-n", "--adjustment"] },
  { program: "time", valueFlags: ["-f", "-o", "--format", "--output"] },
  { program: "timeout", valueFlags: ["-s", "-k", "--signal", "--kill-after"], positionalSkips: 1 },
  { program: "stdbuf", valueFlags: ["-i", "-o", "-e", "--input", "--output", "--error"] },
  {
    program: "xargs",
    valueFlags: [
      "-a",
      "-d",
      "-E",
      "-I",
      "-n",
      "-P",
      "-s",
      "--arg-file",
      "--delimiter",
      "--eof",
      "--replace",
      "--max-args",
      "--max-procs",
      "--max-chars",
    ],
  },
];

let parserPromise: Promise<Parser> | undefined;
let lastParse: { command: string; optionsKey: string; result: ParsedShellCommand } | undefined;

export async function parseShellCommand(
  command: string,
  options: ParseShellCommandOptions = {},
): Promise<ParsedShellCommand> {
  const optionsKey = JSON.stringify(options.wrappers ?? null);
  if (lastParse?.command === command && lastParse.optionsKey === optionsKey)
    return lastParse.result;

  const parser = await getParser();
  const result = parseWithParser(parser, command, 0, options);
  lastParse = { command, optionsKey, result };
  return result;
}

export function matchCommand(
  spec: CommandSpec,
): (tool: BashPermissionToolInput) => Promise<PermissionDecision | undefined> {
  return async (tool) => {
    const parsed = await parseShellCommand(tool.command);
    if (spec.strict && parsed.hasErrors) {
      return request({
        guidance: "The shell command could not be parsed completely.",
        highlight: [{ start: 0, end: tool.command.length }],
      });
    }

    const programs = new Set(asArray(spec.program));
    const wantedSubcommands = spec.subcommands ? new Set(spec.subcommands) : undefined;
    const matches: SimpleCommand[] = [];
    const spans: HighlightSpan[] = [];

    for (const command of parsed.commands) {
      if (!command.programName || !programs.has(command.programName)) continue;

      const subcommand = findMatchingSubcommand(command, wantedSubcommands, spec);
      if (wantedSubcommands && !subcommand) continue;
      if (spec.where && !spec.where(command)) continue;

      matches.push(command);
      if (command.program) spans.push(command.program);
      if (subcommand) spans.push(subcommand);
    }

    return matches.length ? spec.onMatch({ commands: matches, spans }) : undefined;
  };
}

function findMatchingSubcommand(
  command: SimpleCommand,
  wanted: Set<string> | undefined,
  spec: CommandSpec,
): ShellToken | undefined {
  if (!wanted) return undefined;
  const options = tokenWalkOptions(spec.valueFlags);
  if (spec.subcommandPosition === "any") {
    return command.positionals(options).find((token) => wanted.has(token.text));
  }
  const subcommand = command.subcommand(options);
  return subcommand && wanted.has(subcommand.text) ? subcommand : undefined;
}

async function getParser(): Promise<Parser> {
  parserPromise ??= (async () => {
    await Parser.init();
    const require = createRequire(import.meta.url);
    const language = await Language.load(require.resolve("tree-sitter-bash/tree-sitter-bash.wasm"));
    const parser = new Parser();
    parser.setLanguage(language);
    return parser;
  })();
  return parserPromise;
}

function parseWithParser(
  parser: Parser,
  command: string,
  offset: number,
  options: ParseShellCommandOptions,
): ParsedShellCommand {
  const tree = parser.parse(command);
  if (!tree) return { commands: [], hasErrors: true };

  const topLevel: SimpleCommand[] = [];
  let hasErrors = tree.rootNode.hasError;
  collectCommands(tree.rootNode, offset, options, topLevel);

  // Only top-level commands are scanned for -c payloads; the recursive call
  // owns everything below, so nested results must not be re-scanned here.
  const commands = [...topLevel];
  for (const simpleCommand of topLevel) {
    const payload = shellPayload(simpleCommand);
    if (!payload) continue;
    const nested = parseWithParser(parser, payload.text, payload.start, options);
    commands.push(...nested.commands);
    hasErrors ||= nested.hasErrors;
  }

  return { commands, hasErrors };
}

function collectCommands(
  node: SyntaxNode,
  offset: number,
  options: ParseShellCommandOptions,
  commands: SimpleCommand[],
): void {
  if (node.type === "command") {
    commands.push(buildSimpleCommand(node, offset, options));
  }

  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (child) collectCommands(child, offset, options, commands);
  }
}

function buildSimpleCommand(
  node: SyntaxNode,
  offset: number,
  options: ParseShellCommandOptions,
): SimpleCommand {
  const tokens = directCommandTokens(node, offset);
  const assignments: ShellToken[] = [];
  let firstNonAssignment = 0;
  while (firstNonAssignment < tokens.length && isAssignmentToken(tokens[firstNonAssignment])) {
    const assignment = tokens[firstNonAssignment];
    if (assignment) assignments.push(assignment);
    firstNonAssignment += 1;
  }

  const programIndex = resolveProgramIndex(
    tokens.slice(firstNonAssignment),
    options.wrappers ?? defaultWrappers,
  );
  const program =
    programIndex === undefined ? undefined : tokens[firstNonAssignment + programIndex];
  const args =
    programIndex === undefined ? [] : tokens.slice(firstNonAssignment + programIndex + 1);
  const spanNode = redirectedParent(node) ?? node;

  return {
    program,
    programName: program ? basename(program.text) : undefined,
    args,
    assignments,
    span: { start: spanNode.startIndex + offset, end: spanNode.endIndex + offset },
    hasFlag: (...spellings) => hasFlag(args, spellings),
    subcommand: (walkOptions) => positionals(args, walkOptions).at(0),
    positionals: (walkOptions) => positionals(args, walkOptions),
  };
}

function directCommandTokens(node: SyntaxNode, offset: number): ShellToken[] {
  const tokens: ShellToken[] = [];
  for (let index = 0; index < node.namedChildCount; index += 1) {
    const child = node.namedChild(index);
    if (!child) continue;
    if (child.type === "variable_assignment") {
      tokens.push(tokenFromNode(child, offset));
    } else if (child.type === "command_name") {
      tokens.push(tokenFromNode(child.namedChild(0) ?? child, offset));
    } else if (isArgumentNode(child)) {
      tokens.push(tokenFromNode(child, offset));
    }
  }
  return tokens;
}

function isArgumentNode(node: SyntaxNode): boolean {
  return !node.type.includes("redirect") && node.type !== "heredoc_body";
}

function tokenFromNode(node: SyntaxNode, offset: number): ShellToken {
  return {
    start: node.startIndex + offset,
    end: node.endIndex + offset,
    text: decodeTokenText(node),
  };
}

function decodeTokenText(node: SyntaxNode): string {
  if (node.type === "raw_string" && node.text.length >= 2) return node.text.slice(1, -1);
  if (node.type === "string" && node.text.length >= 2)
    return node.text.slice(1, -1).replace(/\\(["\\$`])/g, "$1");
  return node.text;
}

function resolveProgramIndex(
  tokens: readonly ShellToken[],
  wrappers: readonly WrapperSpec[],
): number | undefined {
  let index = 0;
  while (index < tokens.length) {
    while (index < tokens.length && isAssignmentToken(tokens[index])) index += 1;
    const token = tokens[index];
    if (!token) break;
    const wrapper = wrappers.find((candidate) =>
      asArray(candidate.program).includes(basename(token.text)),
    );
    if (!wrapper) return index;

    index += 1;
    index = skipWrapperArguments(tokens, index, wrapper);
  }
  return undefined;
}

function skipWrapperArguments(
  tokens: readonly ShellToken[],
  index: number,
  wrapper: WrapperSpec,
): number {
  let positionalsToSkip = wrapper.positionalSkips ?? 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (!token) break;
    if (isAssignmentToken(token)) {
      index += 1;
      continue;
    }
    if (token.text === "--") return index + 1;
    if (token.text.startsWith("-") && token.text !== "-") {
      const consumesValue = flagConsumesValue(token.text, wrapper.valueFlags ?? []);
      index += consumesValue && !token.text.includes("=") ? 2 : 1;
      continue;
    }
    if (positionalsToSkip > 0) {
      positionalsToSkip -= 1;
      index += 1;
      continue;
    }
    break;
  }
  return index;
}

function hasFlag(tokens: readonly ShellToken[], spellings: readonly string[]): boolean {
  for (const token of tokens) {
    if (token.text === "--") return false;
    if (spellings.some((spelling) => tokenMatchesFlag(token.text, spelling))) return true;
  }
  return false;
}

function tokenMatchesFlag(token: string, spelling: string): boolean {
  if (/^-[^-]$/.test(spelling)) {
    const flagName = spelling.at(1);
    return (
      !!flagName &&
      (token === spelling || (/^-[^-]/.test(token) && token.slice(1).includes(flagName)))
    );
  }
  return token === spelling;
}

function positionals(tokens: readonly ShellToken[], options: TokenWalkOptions = {}): ShellToken[] {
  const result: ShellToken[] = [];
  let flagsDone = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    if (!flagsDone && token.text === "--") {
      flagsDone = true;
      continue;
    }
    if (!flagsDone && token.text.startsWith("-") && token.text !== "-") {
      if (flagConsumesValue(token.text, options.valueFlags ?? []) && !token.text.includes("="))
        index += 1;
      continue;
    }
    result.push(token);
  }
  return result;
}

function flagConsumesValue(token: string, valueFlags: readonly string[]): boolean {
  return valueFlags.some(
    (flag) => token === flag || (flag.startsWith("--") && token.startsWith(`${flag}=`)),
  );
}

function shellPayload(command: SimpleCommand): ShellToken | undefined {
  if (!command.programName || !shellPrograms.has(command.programName)) return undefined;
  const args = command.args;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg.text === "-c") return exactPayloadToken(args[index + 1]);
    if (arg.text.startsWith("-c") && arg.text.length > 2) {
      return { start: arg.start + 2, end: arg.end, text: arg.text.slice(2) };
    }
  }
  return undefined;
}

function exactPayloadToken(token: ShellToken | undefined): ShellToken | undefined {
  if (!token) return undefined;
  const rawLength = token.end - token.start;
  if (rawLength === token.text.length) return token;
  if (rawLength === token.text.length + 2)
    return { start: token.start + 1, end: token.end - 1, text: token.text };
  return undefined;
}

function redirectedParent(node: SyntaxNode): SyntaxNode | undefined {
  const parent = node.parent;
  return parent?.type === "redirected_statement" ? parent : undefined;
}

function isAssignmentToken(token: ShellToken | undefined): boolean {
  return !!token && /^[A-Za-z_][A-Za-z0-9_]*=/.test(token.text);
}

function tokenWalkOptions(valueFlags: readonly string[] | undefined): TokenWalkOptions {
  return valueFlags ? { valueFlags } : {};
}

function asArray<T>(value: T | readonly T[]): readonly T[] {
  return Array.isArray(value) ? value : ([value] as readonly T[]);
}

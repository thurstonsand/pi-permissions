import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  type BashToolCallEvent,
  type EditToolCallEvent,
  type FindToolCallEvent,
  type GrepToolCallEvent,
  isToolCallEventType,
  type LsToolCallEvent,
  type ReadToolCallEvent,
  type ToolCallEvent,
  type WriteToolCallEvent,
} from "@earendil-works/pi-coding-agent";

export type BuiltInToolCallEvent =
  | BashToolCallEvent
  | ReadToolCallEvent
  | EditToolCallEvent
  | WriteToolCallEvent
  | GrepToolCallEvent
  | FindToolCallEvent
  | LsToolCallEvent;

export type BuiltInToolName = BuiltInToolCallEvent["toolName"];
export type PermissionToolName = BuiltInToolName | (string & {});

export interface PermissionInput {
  cwd: string;
  permissionRoot: string;
  tool: PermissionToolInput;
}

export type PermissionToolInput =
  | BashPermissionToolInput
  | ReadPermissionToolInput
  | EditPermissionToolInput
  | WritePermissionToolInput
  | GrepPermissionToolInput
  | FindPermissionToolInput
  | LsPermissionToolInput
  | CustomPermissionToolInput;

interface BasePermissionToolInput<TName extends string, TInput> {
  toolName: TName;
  input: TInput;
  detail: string;
}

export interface BashPermissionToolInput
  extends BasePermissionToolInput<"bash", BashToolCallEvent["input"]> {
  command: string;
}

export interface ReadPermissionToolInput
  extends BasePermissionToolInput<"read", ReadToolCallEvent["input"]> {
  path: string;
  absolutePath: string;
  projectPath?: string;
}

export interface EditPermissionToolInput
  extends BasePermissionToolInput<"edit", EditToolCallEvent["input"]> {
  path: string;
  absolutePath: string;
  projectPath?: string;
}

export interface WritePermissionToolInput
  extends BasePermissionToolInput<"write", WriteToolCallEvent["input"]> {
  path: string;
  absolutePath: string;
  projectPath?: string;
}

export interface GrepPermissionToolInput
  extends BasePermissionToolInput<"grep", GrepToolCallEvent["input"]> {
  path?: string;
  absolutePath?: string;
  projectPath?: string;
}

export interface FindPermissionToolInput
  extends BasePermissionToolInput<"find", FindToolCallEvent["input"]> {
  path?: string;
  absolutePath?: string;
  projectPath?: string;
}

export interface LsPermissionToolInput
  extends BasePermissionToolInput<"ls", LsToolCallEvent["input"]> {
  path?: string;
  absolutePath?: string;
  projectPath?: string;
}

export interface CustomPermissionToolInput<TName extends string = string>
  extends BasePermissionToolInput<TName, Record<string, unknown>> {}

export function permissionToolInputFromToolCall(
  event: ToolCallEvent,
  cwd: string,
): PermissionToolInput {
  if (isToolCallEventType("bash", event)) {
    return {
      toolName: "bash",
      input: event.input,
      command: event.input.command,
      detail: event.input.command,
    };
  }

  if (isToolCallEventType("read", event)) {
    const pathFields = requiredPathFields(event.input.path, cwd);
    return { toolName: "read", input: event.input, ...pathFields };
  }

  if (isToolCallEventType("edit", event)) {
    const pathFields = requiredPathFields(event.input.path, cwd);
    return { toolName: "edit", input: event.input, ...pathFields };
  }

  if (isToolCallEventType("write", event)) {
    const pathFields = requiredPathFields(event.input.path, cwd);
    return { toolName: "write", input: event.input, ...pathFields };
  }

  if (isToolCallEventType("grep", event)) {
    const pathFields = optionalPathFields(event.input.path, cwd, event.input);
    return { toolName: "grep", input: event.input, ...pathFields };
  }

  if (isToolCallEventType("find", event)) {
    const pathFields = optionalPathFields(event.input.path, cwd, event.input);
    return { toolName: "find", input: event.input, ...pathFields };
  }

  if (isToolCallEventType("ls", event)) {
    const pathFields = optionalPathFields(event.input.path, cwd, event.input);
    return { toolName: "ls", input: event.input, ...pathFields };
  }

  return {
    toolName: event.toolName,
    input: event.input,
    detail: formatUnknownInput(event.input),
  };
}

export function isBashToolInput(tool: PermissionToolInput): tool is BashPermissionToolInput {
  return tool.toolName === "bash" && "command" in tool;
}

export function isReadToolInput(tool: PermissionToolInput): tool is ReadPermissionToolInput {
  return tool.toolName === "read" && "path" in tool && "absolutePath" in tool;
}

export function isEditToolInput(tool: PermissionToolInput): tool is EditPermissionToolInput {
  return tool.toolName === "edit" && "path" in tool && "absolutePath" in tool;
}

export function isWriteToolInput(tool: PermissionToolInput): tool is WritePermissionToolInput {
  return tool.toolName === "write" && "path" in tool && "absolutePath" in tool;
}

export function isGrepToolInput(tool: PermissionToolInput): tool is GrepPermissionToolInput {
  return tool.toolName === "grep";
}

export function isFindToolInput(tool: PermissionToolInput): tool is FindPermissionToolInput {
  return tool.toolName === "find";
}

export function isLsToolInput(tool: PermissionToolInput): tool is LsPermissionToolInput {
  return tool.toolName === "ls";
}

export function isCustomToolInput(
  tool: PermissionToolInput,
  toolName: BuiltInToolName,
): tool is never;
export function isCustomToolInput<TName extends string>(
  tool: PermissionToolInput,
  toolName: TName,
): tool is CustomPermissionToolInput<TName>;
export function isCustomToolInput(tool: PermissionToolInput, toolName: string): boolean {
  return tool.toolName === toolName;
}

function requiredPathFields(
  path: string,
  cwd: string,
): {
  detail: string;
  path: string;
  absolutePath: string;
  projectPath?: string;
} {
  const resolved = resolveToolPath(path, cwd);
  return {
    detail: path,
    path,
    absolutePath: resolved.absolutePath,
    ...(resolved.projectPath ? { projectPath: resolved.projectPath } : {}),
  };
}

function optionalPathFields(
  path: string | undefined,
  cwd: string,
  input: unknown,
): {
  detail: string;
  path?: string;
  absolutePath?: string;
  projectPath?: string;
} {
  if (!path) return { detail: formatUnknownInput(input) };

  const resolved = resolveToolPath(path, cwd);
  return {
    detail: path,
    path,
    absolutePath: resolved.absolutePath,
    ...(resolved.projectPath ? { projectPath: resolved.projectPath } : {}),
  };
}

function resolveToolPath(
  path: string,
  cwd: string,
): { absolutePath: string; projectPath?: string } {
  const absolutePath = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  const relativePath = relative(cwd, absolutePath);
  const isInsideCwd =
    relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
  return {
    absolutePath,
    ...(isInsideCwd ? { projectPath: relativePath.split(sep).join("/") } : {}),
  };
}

function formatUnknownInput(input: unknown): string {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

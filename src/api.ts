import type { PermissionHighlight } from "./highlight.js";
import type { PermissionInput } from "./tool-input.js";

export interface PermissionsAPI {
  onToolUse(hook: ToolUsePermissionHook): void;
}

export interface ToolUsePermissionHook {
  name: string;
  description: string;
  handler: PermissionHandler;
}

export type PermissionHandler = (
  input: PermissionInput,
) => PermissionDecision | Promise<PermissionDecision | undefined> | undefined;

export type PermissionDecision =
  | { decision: "block"; reason: string }
  | { decision: "request"; prompt?: PermissionRequestPrompt };

export interface PermissionRequestLabels {
  approveLabel?: string;
  editLabel?: string;
  rejectLabel?: string;
}

export interface PermissionRequestPrompt extends PermissionRequestLabels {
  guidance?: string;
  highlight?: PermissionHighlight;
}

export function block(reason: string): PermissionDecision {
  return { decision: "block", reason };
}

export function request(prompt?: PermissionRequestPrompt): PermissionDecision {
  return prompt ? { decision: "request", prompt } : { decision: "request" };
}

export type PermissionSource = "project" | "user" | `package:${string}`;

export interface RegisteredPermissionHook extends ToolUsePermissionHook {
  source: PermissionSource;
  permissionRoot: string;
  modulePath: string;
}

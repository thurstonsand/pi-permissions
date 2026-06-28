import type { PermissionInput, PermissionToolName } from "./tool-input.js";

export interface PermissionsAPI {
  onToolUse(hook: ToolUsePermissionHook): void;
}

export interface ToolUsePermissionHook {
  name: string;
  description: string;
  matcher?: PermissionMatcher;
  handler: PermissionHandler;
}

export type PermissionMatcher =
  | PermissionToolName
  | readonly PermissionToolName[]
  | PermissionMatcherFunction;

export type PermissionMatcherFunction = (input: PermissionInput) => boolean | Promise<boolean>;

export type PermissionHandler = (
  input: PermissionInput,
) => PermissionDecision | Promise<PermissionDecision | undefined> | undefined;

export type PermissionDecision =
  | { decision: "block"; reason: string }
  | { decision: "request"; prompt?: PermissionRequestPrompt };

export interface PermissionRequestPrompt {
  guidance?: string;
  approveLabel?: string;
  rejectLabel?: string;
}

export function block(reason: string): PermissionDecision {
  return { decision: "block", reason };
}

export function request(prompt?: PermissionRequestPrompt): PermissionDecision {
  return prompt ? { decision: "request", prompt } : { decision: "request" };
}

export interface RegisteredPermissionHook extends ToolUsePermissionHook {
  permissionRoot: string;
  modulePath: string;
}

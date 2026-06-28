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
  | string
  | readonly string[]
  | PermissionMatcherObject
  | PermissionMatcherFunction;

export interface PermissionMatcherObject {
  toolName?: string | readonly string[];
}

export type PermissionMatcherFunction = (input: PermissionInput) => boolean | Promise<boolean>;

export interface PermissionInput {
  cwd: string;
  permissionRoot: string;
  tool: PermissionToolInput;
}

export interface PermissionToolInput {
  toolName: string;
  input: unknown;
}

export type PermissionHandler = (
  input: PermissionInput,
) => PermissionDecision | Promise<PermissionDecision | undefined> | undefined;

export type PermissionDecision =
  | { decision: "pass" }
  | { decision: "block"; reason: string }
  | { decision: "request"; prompt?: PermissionRequestPrompt };

export interface PermissionRequestPrompt {
  guidance?: string;
  approveLabel?: string;
  rejectLabel?: string;
}

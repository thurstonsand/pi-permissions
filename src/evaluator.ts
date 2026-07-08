import type { PermissionRequestPrompt, RegisteredPermissionHook } from "./api.js";
import type { PermissionInput, PermissionToolInput } from "./tool-input.js";

export type TerminalPermissionDecision =
  | { decision: "block"; reason: string }
  | { decision: "request"; prompt?: PermissionRequestPrompt };

export interface PermissionEvaluation {
  hook: RegisteredPermissionHook;
  input: PermissionInput;
  decision: TerminalPermissionDecision;
}

export interface PermissionHookFailure {
  hook: RegisteredPermissionHook;
  input: PermissionInput;
  error: unknown;
}

export interface PermissionEvaluationResult {
  evaluation?: PermissionEvaluation;
  failures: PermissionHookFailure[];
}

export interface PermissionEvaluationInput {
  cwd: string;
  tool: PermissionToolInput;
}

export async function evaluatePermissionHooks(
  hooks: readonly RegisteredPermissionHook[],
  input: PermissionEvaluationInput,
): Promise<PermissionEvaluationResult> {
  const failures: PermissionHookFailure[] = [];

  for (const hook of hooks) {
    const hookInput: PermissionInput = {
      ...input,
      permissionRoot: hook.permissionRoot,
    };

    try {
      const decision = await hook.handler(hookInput);
      if (!decision) continue;

      return { evaluation: { hook, input: hookInput, decision }, failures };
    } catch (error) {
      failures.push({ hook, input: hookInput, error });
    }
  }

  return { failures };
}

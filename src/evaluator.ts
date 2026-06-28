import type { PermissionRequestPrompt, RegisteredPermissionHook } from "./api.js";
import { matchesPermissionInput } from "./matcher.js";
import type { PermissionInput, PermissionToolInput } from "./tool-input.js";

export type TerminalPermissionDecision =
  | { decision: "block"; reason: string }
  | { decision: "request"; prompt?: PermissionRequestPrompt };

export interface PermissionEvaluation {
  hook: RegisteredPermissionHook;
  input: PermissionInput;
  decision: TerminalPermissionDecision;
}

export interface PermissionEvaluationInput {
  cwd: string;
  tool: PermissionToolInput;
}

export async function evaluatePermissionHooks(
  hooks: readonly RegisteredPermissionHook[],
  input: PermissionEvaluationInput,
): Promise<PermissionEvaluation | undefined> {
  for (const hook of hooks) {
    const hookInput: PermissionInput = {
      ...input,
      permissionRoot: hook.permissionRoot,
    };

    if (!(await matchesPermissionInput(hook.matcher, hookInput))) continue;

    const decision = (await hook.handler(hookInput)) ?? { decision: "pass" };
    if (decision.decision === "pass") continue;

    return { hook, input: hookInput, decision };
  }

  return undefined;
}

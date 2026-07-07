import {
  type BashPermissionToolInput,
  type EditPermissionToolInput,
  type FindPermissionToolInput,
  type GrepPermissionToolInput,
  isBashToolInput,
  isEditToolInput,
  isFindToolInput,
  isGrepToolInput,
  isLsToolInput,
  isReadToolInput,
  isWriteToolInput,
  type LsPermissionToolInput,
  type PermissionToolInput,
  type ReadPermissionToolInput,
  type WritePermissionToolInput,
} from "./tool-input.js";

export type ToolMatchResult<T> = T | Promise<T>;

export interface ToolMatchHandlers<T> {
  bash?: (tool: BashPermissionToolInput) => ToolMatchResult<T>;
  read?: (tool: ReadPermissionToolInput) => ToolMatchResult<T>;
  edit?: (tool: EditPermissionToolInput) => ToolMatchResult<T>;
  write?: (tool: WritePermissionToolInput) => ToolMatchResult<T>;
  grep?: (tool: GrepPermissionToolInput) => ToolMatchResult<T>;
  find?: (tool: FindPermissionToolInput) => ToolMatchResult<T>;
  ls?: (tool: LsPermissionToolInput) => ToolMatchResult<T>;
  custom?: Record<string, (tool: PermissionToolInput) => ToolMatchResult<T>>;
  default?: (tool: PermissionToolInput) => ToolMatchResult<T>;
}

export function matchTool<T>(
  tool: PermissionToolInput,
  handlers: ToolMatchHandlers<T>,
): ToolMatchResult<T | undefined> {
  if (isBashToolInput(tool)) return handlers.bash?.(tool) ?? handlers.default?.(tool);
  if (isReadToolInput(tool)) return handlers.read?.(tool) ?? handlers.default?.(tool);
  if (isEditToolInput(tool)) return handlers.edit?.(tool) ?? handlers.default?.(tool);
  if (isWriteToolInput(tool)) return handlers.write?.(tool) ?? handlers.default?.(tool);
  if (isGrepToolInput(tool)) return handlers.grep?.(tool) ?? handlers.default?.(tool);
  if (isFindToolInput(tool)) return handlers.find?.(tool) ?? handlers.default?.(tool);
  if (isLsToolInput(tool)) return handlers.ls?.(tool) ?? handlers.default?.(tool);

  return handlers.custom?.[tool.toolName]?.(tool) ?? handlers.default?.(tool);
}

import type { EntryRenderer } from "@earendil-works/pi-coding-agent";
import { Box, Text, visibleWidth } from "@earendil-works/pi-tui";
import { parsePermissionsState } from "../state.js";

export const renderPermissionsEntry: EntryRenderer = (entry, { expanded }, theme) => {
  const state = parsePermissionsState(entry.data);
  if (!state) return undefined;

  const changed = state.hooks.filter((hook) => hook.changed);
  if (changed.length === 0) return undefined;

  const enabledChanges = changed.filter((hook) => hook.enabled).length;
  const active = state.hooks.filter((hook) => hook.enabled).length;
  const direction =
    enabledChanges === changed.length ? "enabled" : enabledChanges === 0 ? "disabled" : "changed";
  const noun = changed.length === 1 ? "check" : "checks";
  const title = theme.fg("accent", theme.bold("Permissions"));
  const summary = `${title} · ${changed.length} ${noun} ${direction} · ${active}/${state.hooks.length} active`;
  const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));

  if (!expanded) {
    box.addChild(new Text(summary, 0, 0));
    return box;
  }

  const nameWidth = Math.max(0, ...state.hooks.map((hook) => visibleWidth(hook.name)));
  const rows = state.hooks.map((hook) => {
    const marker = hook.changed ? theme.fg("accent", "*") : " ";
    const dot = theme.fg(hook.enabled ? "success" : "warning", hook.enabled ? "●" : "○");
    const name = hook.changed ? theme.bold(hook.name) : hook.name;
    const padding = " ".repeat(Math.max(0, nameWidth - visibleWidth(hook.name)));
    const source = theme.fg("muted", hook.source);
    return `${marker} ${dot} ${name}${padding}  ${source}`;
  });

  box.addChild(new Text(`${summary}\n\n${rows.join("\n")}`, 0, 0));
  return box;
};

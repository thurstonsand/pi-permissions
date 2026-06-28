import { SettingsManager } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import { parseTypeBoxValue } from "./typebox.js";

export const DEFAULT_TOGGLE_SHORTCUT = "alt+p" as KeyId;

const PERMISSIONS_FILE_SETTINGS_SCHEMA = Type.Object({
  toggleShortcut: Type.Optional(Type.String()),
});

const ROOT_SETTINGS_SCHEMA = Type.Object({
  permissions: Type.Optional(PERMISSIONS_FILE_SETTINGS_SCHEMA),
});

type PermissionsFileSettings = Static<typeof PERMISSIONS_FILE_SETTINGS_SCHEMA>;

export interface PermissionsSettings {
  toggleShortcut: KeyId;
}

export function loadSettings(): PermissionsSettings {
  return resolvePermissionsSettings(loadPermissionsFileSettings());
}

function loadPermissionsFileSettings(): PermissionsFileSettings {
  const globalSettings = SettingsManager.create(process.cwd()).getGlobalSettings();
  const parsed = parseTypeBoxValue(ROOT_SETTINGS_SCHEMA, globalSettings, "Invalid settings");
  return parsed.permissions ?? {};
}

function resolvePermissionsSettings(fileSettings: PermissionsFileSettings): PermissionsSettings {
  return {
    toggleShortcut: normalizeShortcut(fileSettings.toggleShortcut),
  };
}

function normalizeShortcut(value: string | undefined): KeyId {
  const trimmed = value?.trim();
  return (trimmed ? trimmed : DEFAULT_TOGGLE_SHORTCUT) as KeyId;
}

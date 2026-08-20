import { browser } from "wxt/browser";
import {
  DEFAULT_ENGINE_SETTINGS,
  type EngineSettings,
} from "@/lib/engine/types";

export interface Settings extends EngineSettings {
  enabled: boolean;
  /** Optional fine-grained PAT with `Contents: read`. Raises 60/hr to 5000/hr. */
  token: string;
  showConfidence: boolean;
  matchGitHubTheme: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  ...DEFAULT_ENGINE_SETTINGS,
  enabled: true,
  token: "",
  showConfidence: true,
  matchGitHubTheme: true,
};

const KEY = "ghget:settings";

export async function loadSettings(): Promise<Settings> {
  try {
    const stored = await browser.storage.local.get(KEY);
    const value = stored[KEY] as Partial<Settings> | undefined;
    return { ...DEFAULT_SETTINGS, ...(value ?? {}) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(
  patch: Partial<Settings>,
): Promise<Settings> {
  const current = await loadSettings();
  const next = { ...current, ...patch };
  await browser.storage.local.set({ [KEY]: next });
  return next;
}

export function onSettingsChanged(handler: (settings: Settings) => void) {
  const listener = (
    changes: Record<string, { newValue?: unknown }>,
    area: string,
  ) => {
    if (area !== "local" || !(KEY in changes)) return;
    handler({
      ...DEFAULT_SETTINGS,
      ...((changes[KEY].newValue ?? {}) as Partial<Settings>),
    });
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

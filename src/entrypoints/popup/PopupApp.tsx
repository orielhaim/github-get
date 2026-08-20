"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button/base";
import { Switch } from "@/components/ui/switch";
import { send } from "@/lib/messaging";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";

export function PopupApp() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle(
      "dark",
      window.matchMedia("(prefers-color-scheme: dark)").matches,
    );
  }, []);

  useEffect(() => {
    void (async () => {
      const result = await send({ type: "ghget:settings:get" });
      if (result.ok && result.kind === "settings") setSettings(result.settings);
    })();
  }, []);

  const update = async (patch: Partial<Settings>) => {
    const result = await send({ type: "ghget:settings:set", patch });
    if (result.ok && result.kind === "settings") setSettings(result.settings);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  };

  return (
    <main className="flex w-80 flex-col gap-4 bg-background p-3 text-foreground">
      <h1 className="text-sm font-semibold">GitHub Get</h1>

      <Switch
        label="Enable the button"
        className="w-full flex-row-reverse justify-between"
        checked={settings.enabled}
        onCheckedChange={(v) => void update({ enabled: v })}
      />
      <Switch
        label="Include pre-releases"
        className="w-full flex-row-reverse justify-between"
        checked={settings.includePrereleases}
        onCheckedChange={(v) => void update({ includePrereleases: v })}
      />
      <Switch
        label="Prefer installers"
        className="w-full flex-row-reverse justify-between"
        checked={settings.preferInstaller}
        onCheckedChange={(v) => void update({ preferInstaller: v })}
      />
      <Switch
        label="Prefer musl on Linux"
        className="w-full flex-row-reverse justify-between"
        checked={settings.preferMusl}
        onCheckedChange={(v) => void update({ preferMusl: v })}
      />
      <Switch
        label="Show match confidence"
        className="w-full flex-row-reverse justify-between"
        checked={settings.showConfidence}
        onCheckedChange={(v) => void update({ showConfidence: v })}
      />

      <label className="flex flex-col gap-1">
        <span className="text-sm text-foreground">GitHub token</span>
        <input
          type="password"
          value={settings.token}
          onChange={(e) => setSettings({ ...settings, token: e.target.value })}
          onBlur={() => void update({ token: settings.token })}
          placeholder="optional"
          className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void send({ type: "ghget:cache:clear" })}
        >
          Clear cache
        </Button>
        {saved ? (
          <span className="text-xs text-muted-foreground">Saved</span>
        ) : null}
      </div>
    </main>
  );
}

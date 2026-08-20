"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type AnalysisResult, analyze } from "@/lib/engine/analyze";
import { detectEnvironment } from "@/lib/engine/environment";
import type { TargetEnv } from "@/lib/engine/types";
import type { RepoRef } from "@/lib/github/repo-context";
import { scrapeDeclaredLatestTag } from "@/lib/github/repo-context";
import { send } from "@/lib/messaging";
import {
  DEFAULT_SETTINGS,
  onSettingsChanged,
  type Settings,
} from "@/lib/settings";
import { DownloadButton } from "./download-button";

export function App({ repo }: { repo: RepoRef }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [env, setEnv] = useState<TargetEnv | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    void (async () => {
      const detected = await detectEnvironment();
      if (alive.current) setEnv(detected);
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const result = await send({ type: "ghget:settings:get" });
      if (result.ok && result.kind === "settings" && alive.current)
        setSettings(result.settings);
    })();
    return onSettingsChanged((next) => {
      if (alive.current) setSettings(next);
    });
  }, []);

  const run = useCallback(
    async (force: boolean) => {
      if (!env) return;
      setLoading(true);
      const result = await send({
        type: "ghget:releases",
        owner: repo.owner,
        repo: repo.repo,
        declaredLatestTag: scrapeDeclaredLatestTag(repo),
        force,
      });
      if (!alive.current) return;

      if (!result.ok || result.kind !== "releases") {
        setAnalysis(
          analyze({
            owner: repo.owner,
            repo: repo.repo,
            releases: [],
            declaredLatestTag: null,
            env,
            settings,
            stale: false,
            rateLimited: false,
            error: result.ok ? "Unexpected response" : result.error,
          }),
        );
        setLoading(false);
        return;
      }

      const payload = result.payload;
      setAnalysis(
        analyze({
          owner: repo.owner,
          repo: repo.repo,
          releases: payload.releases,
          declaredLatestTag: payload.declaredLatestTag,
          env,
          settings,
          stale: payload.stale,
          rateLimited: payload.rateLimited,
          error: payload.error,
        }),
      );
      setLoading(false);
    },
    [env, repo, settings],
  );

  useEffect(() => {
    void run(false);
  }, [run]);

  const handleDownload = useCallback(async (url: string, filename: string) => {
    const result = await send({ type: "ghget:download", url, filename });
    // The downloads API can refuse for reasons we cannot control; navigating
    // to the asset URL is exactly what clicking the link on GitHub would do.
    if (
      !result.ok ||
      (result.kind === "download" && result.downloadId === null)
    ) {
      window.location.href = url;
    }
  }, []);

  const handleToggleChannel = useCallback(async () => {
    await send({
      type: "ghget:settings:set",
      patch: { includePrereleases: !settings.includePrereleases },
    });
  }, [settings.includePrereleases]);

  if (!settings.enabled) return null;

  return (
    <DownloadButton
      analysis={analysis}
      settings={settings}
      loading={loading}
      onDownload={handleDownload}
      onRefresh={() => void run(true)}
      onToggleChannel={handleToggleChannel}
    />
  );
}

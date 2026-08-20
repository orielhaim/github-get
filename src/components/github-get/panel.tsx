"use client";

import { ChevronDown, Download, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button/base";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type AnalysisResult, assetsForOS } from "@/lib/engine/analyze";
import { formatBytes, formatRelativeDate } from "@/lib/engine/format";
import { recommend } from "@/lib/engine/score";
import type { ClassifiedAsset, OS, ScoredAsset } from "@/lib/engine/types";
import { CHANNEL_LABEL } from "@/lib/engine/version";
import { ARCH_LABEL, OS_DISPLAY_ORDER, OS_LABEL } from "@/lib/engine/vocab";
import type { Settings } from "@/lib/settings";
import { NoticeList } from "./notices";
import { Badge, Divider, OSIcon, SectionTitle } from "./primitives";

export interface PanelProps {
  analysis: AnalysisResult;
  settings: Settings;
  loading: boolean;
  selectedReleaseId: number | null;
  selectedProductId: string | null;
  onSelectRelease: (id: number) => void;
  onSelectProduct: (id: string) => void;
  onDownload: (url: string, filename: string) => void;
  onRefresh: () => void;
  onToggleChannel: () => void;
}

export function Panel({
  analysis,
  settings,
  loading,
  selectedReleaseId,
  selectedProductId,
  onSelectRelease,
  onSelectProduct,
  onDownload,
  onRefresh,
  onToggleChannel,
}: PanelProps) {
  const productId = analysis.multiProduct ? selectedProductId : null;
  const productKey = productId ?? "__default__";

  const productReleases = useMemo(
    () => analysis.releases.filter((r) => r.products.includes(productKey)),
    [analysis.releases, productKey],
  );

  // Switching product can land on a release that never shipped that product,
  // so jump to the newest release that actually contains it.
  const prevProductKey = useRef<string | null>(null);
  useEffect(() => {
    if (prevProductKey.current === productKey) return;
    prevProductKey.current = productKey;
    const first = analysis.releases.find((r) =>
      r.products.includes(productKey),
    );
    if (first) onSelectRelease(first.id);
  }, [productKey, analysis, onSelectRelease]);

  const release = useMemo(
    () =>
      productReleases.find((r) => r.id === selectedReleaseId) ??
      productReleases[0] ??
      null,
    [productReleases, selectedReleaseId],
  );

  const rec = useMemo(() => {
    if (!release) return null;
    return recommend(
      release,
      productId,
      analysis.env,
      settings,
      analysis.priors,
      analysis.multiProduct,
    );
  }, [release, productId, analysis, settings]);

  // Ranked builds for the user's own platform, grouped by architecture. The
  // download button reveals these instead of guessing when several exist.
  const myOsAssets: ScoredAsset[] = useMemo(() => {
    if (!release || !analysis.env.os) return [];
    return assetsForOS(
      release,
      analysis.env.os,
      productId,
      analysis.env,
      settings,
      analysis.priors,
    );
  }, [release, analysis.env, productId, settings, analysis.priors]);

  const archOptions = useMemo(() => {
    const best = new Map<string, ScoredAsset>();
    for (const s of myOsAssets) {
      const key = s.asset.arch ?? "any";
      const existing = best.get(key);
      if (!existing || s.score > existing.score) best.set(key, s);
    }
    return [...best.entries()]
      .sort((a, b) => b[1].score - a[1].score)
      .map(([arch, scored]) => ({ arch, scored }));
  }, [myOsAssets]);

  const primary =
    archOptions[0]?.scored ?? (analysis.env.os ? null : (rec?.top ?? null));
  const [archOpen, setArchOpen] = useState(false);

  const handlePrimaryClick = () => {
    if (!primary) return;
    if (archOptions.length > 1) {
      setArchOpen((v) => !v);
      return;
    }
    onDownload(primary.asset.url, primary.asset.name);
  };

  const groups = useMemo(() => {
    if (!release) return [];
    const pool = release.assets.filter(
      (a) => productId === null || (a.product ?? "__default__") === productId,
    );
    const byOs = new Map<string, ClassifiedAsset[]>();
    for (const asset of pool) {
      const key = asset.os ?? "";
      const arr = byOs.get(key);
      if (arr) arr.push(asset);
      else byOs.set(key, [asset]);
    }
    const order = [...OS_DISPLAY_ORDER];
    if (analysis.env.os) order.unshift(analysis.env.os);
    const keys = [...new Set([...order, ""])].filter((k) => byOs.has(k));
    return keys.map((os) => ({ os: os || null, assets: byOs.get(os)! }));
  }, [release, productId, analysis.env.os]);

  const productLabel =
    analysis.products.find((p) => p.id === productKey)?.label ??
    analysis.products[0]?.label;

  if (analysis.status === "error") {
    return (
      <Shell>
        <p className="text-[13px] text-foreground">
          Could not read the releases for this repository.
        </p>
        <p className="text-[11px] text-muted-foreground">{analysis.error}</p>
        <Button
          size="sm"
          variant="secondary"
          onClick={onRefresh}
          className="mt-1 self-start"
        >
          <RefreshCw className="mr-1.5 size-3.5" aria-hidden />
          Try again
        </Button>
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="flex min-w-0 items-center gap-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {release ? (
            <Select
              value={String(release.id)}
              onValueChange={(v) => onSelectRelease(Number(v))}
              className="shrink-0"
            >
              <SelectTrigger className="h-7! w-[7.25rem] gap-1 rounded-lg! px-2! py-0! text-[12px]">
                <SelectValue
                  placeholder="Version"
                  className="truncate font-medium tabular-nums"
                />
              </SelectTrigger>
              <SelectContent className="left-auto right-0 w-64">
                {productReleases.map((r) => (
                  <SelectItem
                    key={r.id}
                    value={String(r.id)}
                    label={r.version.display}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="truncate font-medium tabular-nums text-foreground">
                        {r.version.display}
                      </span>
                      {r.isDeclaredLatest ? (
                        <Badge tone="success">Latest</Badge>
                      ) : null}
                      {r.channel !== "stable" ? (
                        <Badge tone="warn">{CHANNEL_LABEL[r.channel]}</Badge>
                      ) : null}
                      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                        {formatRelativeDate(r.publishedAt)}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {release?.isDeclaredLatest ? (
            <Badge tone="success">Latest</Badge>
          ) : null}
          {release && release.channel !== "stable" ? (
            <Badge tone="warn">{CHANNEL_LABEL[release.channel]}</Badge>
          ) : null}
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={onRefresh}
          aria-label="Refresh releases"
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="size-4" aria-hidden />
          )}
        </Button>
      </header>

      <NoticeList notices={analysis.notices} />

      {analysis.multiProduct ? (
        <Tabs
          value={selectedProductId ?? ""}
          onValueChange={onSelectProduct}
          variant="segment"
          className="min-w-0"
        >
          <TabsList className="w-full">
            {analysis.products.map((product) => (
              <TabsTrigger key={product.id} value={product.id}>
                {product.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}

      {primary ? (
        <div className="rounded-xl bg-card/60 p-2.5 ring-1 ring-border">
          <div className="flex items-center justify-between gap-2 px-1 pb-1.5">
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
              <OSIcon os={analysis.env.os} className="text-foreground" />
              {analysis.env.os ? OS_LABEL[analysis.env.os] : "Download"}
            </span>
            {archOptions.length > 1 ? (
              <span className="text-[11px] text-muted-foreground">
                Pick an architecture
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                Recommended
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={handlePrimaryClick}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Download className="size-4 shrink-0" aria-hidden />
            <span className="truncate">
              {primaryLabel(primary.asset, analysis.env.os)}
            </span>
            {archOptions.length > 1 ? (
              <ChevronDown
                className={
                  archOpen
                    ? "size-4 shrink-0 rotate-180 transition-transform"
                    : "size-4 shrink-0 transition-transform"
                }
                aria-hidden
              />
            ) : null}
          </button>

          {archOpen && archOptions.length > 1 ? (
            <div className="mt-2 flex flex-col gap-0.5">
              {archOptions.map(({ arch, scored }) => (
                <button
                  key={arch}
                  type="button"
                  onClick={() =>
                    onDownload(scored.asset.url, scored.asset.name)
                  }
                  className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-card"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-foreground">
                      {arch === "any"
                        ? "Any architecture"
                        : (ARCH_LABEL[arch as keyof typeof ARCH_LABEL] ?? arch)}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {scored.asset.name}
                      {scored.asset.size > 0
                        ? ` · ${formatBytes(scored.asset.size)}`
                        : ""}
                    </span>
                  </span>
                  <Download
                    className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                    aria-hidden
                  />
                </button>
              ))}
            </div>
          ) : (
            <p
              className="mt-1.5 truncate px-1 text-[11px] text-muted-foreground"
              title={primary.asset.name}
            >
              {primary.asset.name}
              {primary.asset.size > 0
                ? ` · ${formatBytes(primary.asset.size)}`
                : ""}
            </p>
          )}
        </div>
      ) : (
        <p className="px-1 py-1 text-[12px] text-muted-foreground">
          {analysis.env.os
            ? `No build for ${OS_LABEL[analysis.env.os]} in this version.`
            : "Nothing here matches your system."}
        </p>
      )}

      <div className="flex flex-col gap-0.5">
        <Divider />
        <SectionTitle>Platforms</SectionTitle>
        <div className="flex flex-col gap-1.5">
          {groups.map((group) => (
            <PlatformGroup
              key={group.os ?? "any"}
              os={group.os}
              assets={group.assets}
              currentOs={analysis.env.os}
              onDownload={onDownload}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={onToggleChannel}
          className="mt-1 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[12px] text-muted-foreground hover:bg-card hover:text-foreground"
        >
          <span>Include pre-releases</span>
          <Badge tone={settings.includePrereleases ? "accent" : "neutral"}>
            {settings.includePrereleases ? "On" : "Off"}
          </Badge>
        </button>
      </div>
    </Shell>
  );
}

function PlatformGroup({
  os,
  assets,
  currentOs,
  onDownload,
}: {
  os: OS | null;
  assets: ClassifiedAsset[];
  currentOs: OS | null;
  onDownload: (url: string, filename: string) => void;
}) {
  const [open, setOpen] = useState(os === currentOs);
  const label = os ? OS_LABEL[os] : "Any platform";

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
      >
        <OSIcon os={os} className="text-muted-foreground" />
        <span className="flex-1 text-[12px] font-medium text-foreground">
          {label}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {assets.length}
        </span>
        <ChevronDown
          className={
            open
              ? "size-3.5 rotate-180 transition-transform"
              : "size-3.5 transition-transform"
          }
          aria-hidden
        />
      </button>
      {open ? (
        <div className="border-t border-border p-1">
          {assets.map((asset) => (
            <button
              key={asset.id}
              type="button"
              onClick={() => onDownload(asset.url, asset.name)}
              className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-card"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-foreground">
                  {asset.name}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  {asset.arch ? <Badge>{ARCH_LABEL[asset.arch]}</Badge> : null}
                  {asset.libc ? <Badge>{asset.libc}</Badge> : null}
                  {asset.size > 0 ? (
                    <span className="tabular-nums">
                      {formatBytes(asset.size)}
                    </span>
                  ) : null}
                </span>
              </span>
              <Download
                className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                aria-hidden
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function primaryLabel(asset: ClassifiedAsset, os: OS | null): string {
  const platform = os ? OS_LABEL[os] : asset.os ? OS_LABEL[asset.os] : null;
  return platform ? `Download for ${platform}` : "Download";
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-[min(92vw,25rem)] min-w-0 flex-col gap-2.5 rounded-2xl border border-border bg-popover p-3 text-popover-foreground shadow-xl">
      {children}
    </div>
  );
}

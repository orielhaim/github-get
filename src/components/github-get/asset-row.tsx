"use client";

import { Download, TriangleAlert } from "lucide-react";
import { formatBytes, formatCount } from "@/lib/engine/format";
import type { ScoredAsset } from "@/lib/engine/types";
import { ARCH_LABEL } from "@/lib/engine/vocab";
import { cn } from "@/lib/utils";
import { Badge, ConfidenceBar, OSIcon } from "./primitives";

export function AssetRow({
  scored,
  onDownload,
  showConfidence,
  confidence,
  compact = false,
}: {
  scored: ScoredAsset;
  onDownload: (url: string, filename: string) => void;
  showConfidence?: boolean;
  confidence?: number;
  compact?: boolean;
}) {
  const { asset, warnings } = scored;

  return (
    <button
      type="button"
      onClick={() => onDownload(asset.url, asset.name)}
      className={cn(
        "group flex w-full items-start gap-2.5 rounded-lg border border-transparent px-2 py-2 text-left",
        "transition-colors hover:border-border hover:bg-card focus-visible:outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <OSIcon os={asset.os} className="mt-0.5 text-muted-foreground" />

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-medium text-foreground">
            {asset.name}
          </span>
        </span>

        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          {asset.arch ? <Badge>{ARCH_LABEL[asset.arch]}</Badge> : null}
          {asset.libc ? <Badge>{asset.libc}</Badge> : null}
          {asset.accelerator && asset.accelerator !== "cpu" ? (
            <Badge tone="warn">{asset.accelerator.toUpperCase()}</Badge>
          ) : null}
          {asset.kind === "installer" ? (
            <Badge tone="accent">Installer</Badge>
          ) : null}
          {asset.kind === "portable" || asset.flags.portable ? (
            <Badge>Portable</Badge>
          ) : null}
          {asset.kind === "source" ? <Badge>Source</Badge> : null}
          {asset.size > 0 ? (
            <span className="tabular-nums">{formatBytes(asset.size)}</span>
          ) : null}
          {asset.downloadCount > 0 && !compact ? (
            <span className="tabular-nums">
              {formatCount(asset.downloadCount)} downloads
            </span>
          ) : null}
          {showConfidence && confidence !== undefined ? (
            <ConfidenceBar value={confidence} />
          ) : null}
        </span>

        {warnings.length > 0 && !compact ? (
          <span className="mt-1 flex items-start gap-1 text-[11px] text-amber-600 dark:text-amber-400">
            <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
            <span>{warnings.join(" · ")}</span>
          </span>
        ) : null}
      </span>

      <Download
        className="mt-0.5 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden
      />
    </button>
  );
}

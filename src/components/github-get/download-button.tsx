"use client";

import { AlertCircle, Download, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button/base";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { AnalysisResult } from "@/lib/engine/analyze";
import { recommend } from "@/lib/engine/score";
import type { Settings } from "@/lib/settings";
import { Panel } from "./panel";

export interface DownloadButtonProps {
  analysis: AnalysisResult | null;
  settings: Settings;
  loading: boolean;
  onDownload: (url: string, filename: string) => void;
  onRefresh: () => void;
  onToggleChannel: () => void;
}

export function DownloadButton({
  analysis,
  settings,
  loading,
  onDownload,
  onRefresh,
  onToggleChannel,
}: DownloadButtonProps) {
  const [open, setOpen] = useState(false);
  const [releaseId, setReleaseId] = useState<number | null>(null);
  const [productId, setProductId] = useState<string | null>(null);

  // Follow the engine's default until the user overrides it, then keep their
  // choice unless the repository itself changed underneath us.
  useEffect(() => {
    setReleaseId(analysis?.defaultReleaseId ?? null);
    setProductId(analysis?.defaultProductId ?? null);
  }, [analysis?.defaultReleaseId, analysis?.defaultProductId]);

  const release = useMemo(
    () => analysis?.releases.find((r) => r.id === releaseId) ?? null,
    [analysis, releaseId],
  );

  const rec = useMemo(() => {
    if (!analysis || !release) return null;
    return recommend(
      release,
      analysis.multiProduct ? productId : null,
      analysis.env,
      settings,
      analysis.priors,
      analysis.multiProduct,
    );
  }, [analysis, release, productId, settings]);

  const handlePrimary = useCallback(
    (event: React.MouseEvent) => {
      if (rec?.top && rec.level === "auto") {
        event.preventDefault();
        event.stopPropagation();
        onDownload(rec.top.asset.url, rec.top.asset.name);
      }
    },
    [rec, onDownload],
  );

  const label = buildLabel(analysis, loading);
  const disabled = loading && !analysis;

  return (
    <div className="flex items-stretch" data-ghget-root="">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              size="sm"
              variant="primary"
              onClick={handlePrimary}
              disabled={disabled}
              ripple
              className="gg-download-btn relative h-8 gap-1.5 overflow-hidden rounded-md px-3.5 text-[13px] font-semibold"
              style={{ fontFamily: "var(--gg-font, inherit)" }}
            />
          }
        >
          {loading && !analysis ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : analysis?.status === "error" ? (
            <AlertCircle className="size-3.5" aria-hidden />
          ) : (
            <Download className="size-3.5" aria-hidden />
          )}
          <span className="truncate">{label}</span>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end" sideOffset={12}>
          {analysis ? (
            <Panel
              analysis={analysis}
              settings={settings}
              loading={loading}
              selectedReleaseId={releaseId}
              selectedProductId={productId}
              onSelectRelease={setReleaseId}
              onSelectProduct={setProductId}
              onDownload={(url, filename) => {
                onDownload(url, filename);
                setOpen(false);
              }}
              onRefresh={onRefresh}
              onToggleChannel={onToggleChannel}
            />
          ) : (
            <div className="flex w-64 flex-col items-center gap-2 rounded-2xl border border-border bg-popover p-5 text-center">
              <Loader2
                className="size-5 animate-spin text-muted-foreground"
                aria-hidden
              />
              <p className="text-[12px] text-muted-foreground">
                Checking for releases…
              </p>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function buildLabel(analysis: AnalysisResult | null, loading: boolean): string {
  if (loading && !analysis) return "Download";
  if (analysis?.status === "error") return "Unavailable";
  if (analysis?.status === "no-releases") return "No releases";
  if (analysis?.status === "no-usable-assets") return "Source only";
  return "Download";
}

"use client";

import { Check, Tag } from "lucide-react";
import { formatRelativeDate } from "@/lib/engine/format";
import type { ClassifiedRelease } from "@/lib/engine/types";
import { CHANNEL_LABEL } from "@/lib/engine/version";
import { cn } from "@/lib/utils";
import { Badge } from "./primitives";

export function VersionList({
  releases,
  selectedId,
  onSelect,
}: {
  releases: ClassifiedRelease[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <div className="max-h-56 overflow-y-auto pr-0.5">
      {releases.map((release) => {
        const active = release.id === selectedId;
        const empty = release.usableAssets.length === 0;
        return (
          <button
            key={release.id}
            type="button"
            onClick={() => onSelect(release.id)}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
              active ? "bg-card" : "hover:bg-card/60",
            )}
          >
            <Tag
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[13px] font-medium text-foreground">
                  {release.version.display}
                </span>
                {release.isDeclaredLatest ? (
                  <Badge tone="success">Latest</Badge>
                ) : null}
                {release.channel !== "stable" ? (
                  <Badge tone="warn">{CHANNEL_LABEL[release.channel]}</Badge>
                ) : null}
                {empty ? <Badge>No files</Badge> : null}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {formatRelativeDate(release.publishedAt)}
                {release.availableOS.length > 0
                  ? ` · ${release.availableOS.length} platform${release.availableOS.length === 1 ? "" : "s"}`
                  : ""}
              </span>
            </span>
            {active ? (
              <Check className="size-4 shrink-0 text-foreground" aria-hidden />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

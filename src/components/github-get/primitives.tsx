"use client";

import {
  Apple,
  Boxes,
  type LucideIcon,
  Monitor,
  Smartphone,
  Terminal,
} from "lucide-react";
import type { ReactNode } from "react";
import type { OS } from "@/lib/engine/types";
import { OS_LABEL } from "@/lib/engine/vocab";
import { cn } from "@/lib/utils";

const OS_ICON: Partial<Record<OS, LucideIcon>> = {
  windows: Monitor,
  macos: Apple,
  linux: Terminal,
  android: Smartphone,
  ios: Smartphone,
};

export function OSIcon({
  os,
  className,
}: {
  os: OS | null;
  className?: string;
}) {
  const Icon = (os && OS_ICON[os]) ?? Boxes;
  return <Icon className={cn("size-4 shrink-0", className)} aria-hidden />;
}

export function osLabel(os: OS | null) {
  return os ? OS_LABEL[os] : "Any platform";
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "warn" | "success";
  className?: string;
}) {
  const tones = {
    neutral: "border-border bg-card text-muted-foreground",
    accent: "border-transparent bg-accent text-accent-foreground",
    warn: "border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400",
    success:
      "border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  } as const;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-px text-[11px] font-medium leading-5",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone =
    value >= 0.82
      ? "bg-emerald-500"
      : value >= 0.6
        ? "bg-amber-500"
        : "bg-muted-foreground";
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={`Match confidence ${pct}%`}
    >
      <span className="h-1 w-10 overflow-hidden rounded-full bg-border">
        <span
          className={cn("block h-full rounded-full", tone)}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {pct}%
      </span>
    </span>
  );
}

export function Row({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>{children}</div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="px-1 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

export function Divider() {
  return <div className="my-2 h-px w-full bg-border" />;
}

"use client";

import { Info, TriangleAlert } from "lucide-react";
import type { Notice } from "@/lib/engine/types";

export function NoticeList({ notices }: { notices: Notice[] }) {
  if (notices.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {notices.map((notice) => {
        const Icon = notice.tone === "warn" ? TriangleAlert : Info;
        return (
          <p
            key={`${notice.title}${notice.detail ?? ""}`}
            className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground"
          >
            <Icon
              className={
                notice.tone === "warn"
                  ? "mt-px size-3.5 shrink-0 text-amber-500"
                  : "mt-px size-3.5 shrink-0 text-muted-foreground"
              }
              aria-hidden
            />
            <span>
              {notice.title}
              {notice.detail ? (
                <span className="text-muted-foreground/80">
                  {" "}
                  - {notice.detail}
                </span>
              ) : null}
            </span>
          </p>
        );
      })}
    </div>
  );
}

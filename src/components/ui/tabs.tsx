"use client";
// beui.dev/components/motion/tabs

import { motion, useReducedMotion } from "motion/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

type Variant = "pill" | "underline" | "segment";

type Ctx = {
  value: string;
  setValue: (v: string) => void;
  variant: Variant;
};

const TabsCtx = createContext<Ctx | null>(null);

function useTabs() {
  const ctx = useContext(TabsCtx);
  if (!ctx) throw new Error("Tabs.* must be used inside <Tabs>");
  return ctx;
}

export function Tabs({
  defaultValue,
  value,
  onValueChange,
  variant = "pill",
  children,
  className,
}: {
  defaultValue?: string;
  value?: string;
  onValueChange?: (v: string) => void;
  variant?: Variant;
  children: ReactNode;
  className?: string;
}) {
  const [internal, setInternal] = useState(defaultValue ?? "");
  const controlled = value !== undefined;
  const current = controlled ? value : internal;
  const setValue = useCallback(
    (v: string) => {
      if (!controlled) setInternal(v);
      onValueChange?.(v);
    },
    [controlled, onValueChange],
  );
  const contextValue = useMemo(
    () => ({ value: current, setValue, variant }),
    [current, setValue, variant],
  );
  return (
    <TabsCtx.Provider value={contextValue}>
      <div className={className}>{children}</div>
    </TabsCtx.Provider>
  );
}

const listClasses: Record<Variant, string> = {
  pill: "gap-1 rounded-full bg-card p-1",
  underline: "gap-1 border-b border-border",
  segment: "gap-0 rounded-lg bg-card p-0.5",
};

// The active indicator is measured with offsetLeft/offsetWidth against the
// list instead of a shared layout animation: framer's layoutId projects in
// page coordinates, which replays the popover's own transform as sideways
// movement. Offsets are layout values, so they stay correct under transforms.
export function TabsList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { value, variant } = useTabs();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{
    left: number;
    width: number;
  } | null>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const active = list.querySelector<HTMLElement>(
        `[data-tab-value="${value}"]`,
      );
      setIndicator(
        active ? { left: active.offsetLeft, width: active.offsetWidth } : null,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [value, children]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>(
      `[data-tab-value="${value}"]`,
    );
    if (!scroller || !active) return;
    const left = active.offsetLeft;
    const right = left + active.offsetWidth;
    if (left < scroller.scrollLeft) scroller.scrollLeft = left;
    else if (right > scroller.scrollLeft + scroller.clientWidth) {
      scroller.scrollLeft = right - scroller.clientWidth;
    }
  }, [value]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const onWheel = (event: WheelEvent) => {
      if (scroller.scrollWidth <= scroller.clientWidth) return;
      scroller.scrollLeft += event.deltaY + event.deltaX;
      event.preventDefault();
    };

    let pointerId: number | null = null;
    let startX = 0;
    let startScroll = 0;
    let dragging = false;
    let ignoreClick = false;

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startScroll = scroller.scrollLeft;
      dragging = false;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      const delta = event.clientX - startX;
      if (!dragging && Math.abs(delta) > 6) {
        dragging = true;
        scroller.setPointerCapture(event.pointerId);
      }
      if (dragging) scroller.scrollLeft = startScroll - delta;
    };
    const onPointerUp = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      if (dragging) ignoreClick = true;
      dragging = false;
      pointerId = null;
    };
    const onClickCapture = (event: MouseEvent) => {
      if (!ignoreClick) return;
      ignoreClick = false;
      event.preventDefault();
    };

    scroller.addEventListener("wheel", onWheel, { passive: false });
    scroller.addEventListener("pointerdown", onPointerDown);
    scroller.addEventListener("pointermove", onPointerMove);
    scroller.addEventListener("pointerup", onPointerUp);
    scroller.addEventListener("pointercancel", onPointerUp);
    scroller.addEventListener("click", onClickCapture, true);
    return () => {
      scroller.removeEventListener("wheel", onWheel);
      scroller.removeEventListener("pointerdown", onPointerDown);
      scroller.removeEventListener("pointermove", onPointerMove);
      scroller.removeEventListener("pointerup", onPointerUp);
      scroller.removeEventListener("pointercancel", onPointerUp);
      scroller.removeEventListener("click", onClickCapture, true);
    };
  }, []);

  const inset =
    variant === "pill"
      ? "top-1 bottom-1"
      : variant === "segment"
        ? "top-0.5 bottom-0.5"
        : "";
  const radius = variant === "pill" ? "rounded-full" : "rounded-md";

  return (
    <div
      ref={scrollerRef}
      className={cn(
        "min-w-0 max-w-full touch-pan-x overflow-x-auto overscroll-x-contain scrollbar-none",
        className,
      )}
    >
      <div
        ref={listRef}
        role="tablist"
        className={cn("relative flex w-max min-w-full", listClasses[variant])}
      >
        {variant !== "underline" && indicator ? (
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute z-0 bg-primary transition-[left,width] duration-300 ease-out",
              inset,
              radius,
            )}
            style={{ left: indicator.left, width: indicator.width }}
          />
        ) : null}
        {children}
      </div>
    </div>
  );
}

export function TabsTrigger({
  value,
  children,
  className,
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  const { value: current, setValue, variant } = useTabs();
  const active = current === value;

  if (variant === "underline") {
    return (
      <button
        type="button"
        role="tab"
        data-tab-value={value}
        aria-selected={active}
        onClick={() => setValue(value)}
        className={cn(
          "relative isolate -mb-px inline-flex min-h-[44px] items-center px-3 pb-2.5 pt-1 text-sm font-medium transition-colors",
          active
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground",
          className,
        )}
      >
        {children}
        {active ? (
          <span
            className="absolute -bottom-px left-0 right-0 h-px bg-primary"
            aria-hidden
          />
        ) : null}
      </button>
    );
  }

  const radius = variant === "pill" ? "rounded-full" : "rounded-md";

  return (
    <button
      type="button"
      role="tab"
      data-tab-value={value}
      aria-selected={active}
      onClick={() => setValue(value)}
      className={cn(
        "relative z-10 inline-flex shrink-0 items-center justify-center whitespace-nowrap bg-transparent px-2.5 py-1.5 text-[12px] font-medium outline-none transition-colors",
        radius,
        active
          ? "text-primary-foreground"
          : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  children,
  className,
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  const { value: current } = useTabs();
  const reduce = useReducedMotion();
  const active = current === value;
  // Inactive panels stay mounted but hidden, so their content (e.g. source
  // code) is present in the server-rendered HTML for crawlers and assistive
  // tech, instead of being dropped from the DOM.
  if (!active) {
    return (
      <div hidden className={className}>
        {children}
      </div>
    );
  }
  return (
    <motion.div
      key={value}
      initial={{ opacity: 0, y: reduce ? 0 : 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: EASE_OUT }}
      className={cn("mt-4", className)}
    >
      {children}
    </motion.div>
  );
}

"use client";

import { createContext, useContext } from "react";

/**
 * Inside a shadow root, `createPortal(node, document.body)` escapes the root
 * and loses every style. Providing the shadow root's own <body> keeps portals
 * both styled and event-isolated.
 */
export const PortalTargetContext = createContext<HTMLElement | null>(null);

export function usePortalTarget(): HTMLElement | null {
  const provided = useContext(PortalTargetContext);
  if (provided) return provided;
  return typeof document === "undefined" ? null : document.body;
}

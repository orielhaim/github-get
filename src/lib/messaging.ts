import { browser } from "wxt/browser";
import type { ReleasesPayload } from "@/lib/github/types";
import type { Settings } from "@/lib/settings";

export type Message =
  | {
      type: "ghget:releases";
      owner: string;
      repo: string;
      declaredLatestTag: string | null;
      force?: boolean;
    }
  | { type: "ghget:download"; url: string; filename: string }
  | { type: "ghget:settings:get" }
  | { type: "ghget:settings:set"; patch: Partial<Settings> }
  | { type: "ghget:cache:clear" };

export type MessageResult =
  | { ok: true; kind: "releases"; payload: ReleasesPayload }
  | { ok: true; kind: "download"; downloadId: number | null }
  | { ok: true; kind: "settings"; settings: Settings }
  | { ok: true; kind: "void" }
  | { ok: false; error: string };

export async function send(message: Message): Promise<MessageResult> {
  try {
    const result = (await browser.runtime.sendMessage(message)) as
      | MessageResult
      | undefined;
    if (!result)
      return { ok: false, error: "No response from the background worker" };
    return result;
  } catch (cause) {
    return {
      ok: false,
      error:
        cause instanceof Error ? cause.message : "Extension messaging failed",
    };
  }
}

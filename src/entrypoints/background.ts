import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import {
  apiGet,
  latestReleasePath,
  listReleasesPath,
  type ReleaseList,
} from "@/lib/github/client";
import type {
  GitHubRelease,
  RateLimitState,
  ReleasesPayload,
} from "@/lib/github/types";
import type { Message, MessageResult } from "@/lib/messaging";
import { loadSettings, saveSettings } from "@/lib/settings";

interface CacheEntry {
  releases: GitHubRelease[];
  declaredLatestTag: string | null;
  etag: string | null;
  fetchedAt: number;
  /** Set when a repo genuinely has no releases, so we stop re-asking. */
  empty: boolean;
}

const FRESH_MS = 10 * 60 * 1000;
const NEGATIVE_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 300;
/**
 * Never spend the last few unauthenticated requests. Hitting zero gets the
 * whole IP throttled, which would break the extension for every tab.
 */
const BUDGET_FLOOR = 6;

const cache = new Map<string, CacheEntry>();

let rateLimit: RateLimitState = {
  limit: null,
  remaining: null,
  reset: null,
  resource: null,
  authenticated: false,
};
let cooldownUntil = 0;

/** Serial queue - concurrent bursts are what trips secondary rate limits. */
let chain: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

function trim() {
  if (cache.size <= MAX_ENTRIES) return;
  const sorted = [...cache.entries()].sort(
    (a, b) => a[1].fetchedAt - b[1].fetchedAt,
  );
  for (let i = 0; i < sorted.length - MAX_ENTRIES; i += 1)
    cache.delete(sorted[i][0]);
}

function budgetAvailable(): boolean {
  if (Date.now() < cooldownUntil) return false;
  if (rateLimit.remaining === null) return true;
  return rateLimit.remaining > BUDGET_FLOOR;
}

function noteRateLimit(next: RateLimitState, retryAfter: number | null) {
  if (next.remaining !== null || next.limit !== null) rateLimit = next;
  if (retryAfter && retryAfter > 0) {
    cooldownUntil = Date.now() + retryAfter * 1000;
  } else if (next.remaining === 0 && next.reset) {
    cooldownUntil = next.reset * 1000;
  }
}

async function fetchReleases(
  owner: string,
  repo: string,
  hintTag: string | null,
  force: boolean,
): Promise<ReleasesPayload> {
  const key = `${owner}/${repo}`.toLowerCase();
  const cached = cache.get(key);
  const settings = await loadSettings();
  const token = settings.token.trim() || null;

  const age = cached ? Date.now() - cached.fetchedAt : Number.POSITIVE_INFINITY;
  const ttl = cached?.empty ? NEGATIVE_MS : FRESH_MS;

  const base = (over: Partial<ReleasesPayload> = {}): ReleasesPayload => ({
    owner,
    repo,
    releases: cached?.releases ?? [],
    declaredLatestTag: hintTag ?? cached?.declaredLatestTag ?? null,
    fetchedAt: cached?.fetchedAt ?? 0,
    stale: false,
    rateLimited: false,
    rateLimit,
    error: null,
    ...over,
  });

  if (cached && !force && age < ttl) return base();

  if (!budgetAvailable()) {
    return base({ stale: Boolean(cached), rateLimited: true });
  }

  const result = await apiGet<ReleaseList>(listReleasesPath(owner, repo), {
    token,
    // Conditional requests only skip primary quota when authenticated, but
    // they still save bandwidth and parse time for everyone.
    etag: force ? null : (cached?.etag ?? null),
  });
  noteRateLimit(result.rateLimit, result.retryAfter);

  if (result.notModified && cached) {
    cached.fetchedAt = Date.now();
    if (hintTag) cached.declaredLatestTag = hintTag;
    return base({ fetchedAt: cached.fetchedAt });
  }

  if (result.error === "rate-limited") {
    return base({ stale: Boolean(cached), rateLimited: true });
  }

  if (result.error || result.data === null) {
    if (result.status === 404) {
      cache.set(key, {
        releases: [],
        declaredLatestTag: null,
        etag: null,
        fetchedAt: Date.now(),
        empty: true,
      });
      return base({ releases: [], fetchedAt: Date.now() });
    }
    return base({
      stale: Boolean(cached),
      error: cached ? null : result.error,
    });
  }

  const releases = result.data.filter((r) => r.draft !== true);
  let declaredLatestTag = hintTag;

  // Only pay for /releases/latest when the page did not already tell us and
  // there is budget to spare. It is a nicety, not a requirement.
  if (!declaredLatestTag && releases.length > 1 && budgetAvailable()) {
    const latest = await apiGet<GitHubRelease>(latestReleasePath(owner, repo), {
      token,
    });
    noteRateLimit(latest.rateLimit, latest.retryAfter);
    if (latest.data) declaredLatestTag = latest.data.tag_name;
  }

  const entry: CacheEntry = {
    releases,
    declaredLatestTag: declaredLatestTag ?? null,
    etag: result.etag,
    fetchedAt: Date.now(),
    empty: releases.length === 0,
  };
  cache.set(key, entry);
  trim();

  return {
    owner,
    repo,
    releases,
    declaredLatestTag: entry.declaredLatestTag,
    fetchedAt: entry.fetchedAt,
    stale: false,
    rateLimited: false,
    rateLimit,
    error: null,
  };
}

async function startDownload(
  url: string,
  filename: string,
): Promise<number | null> {
  try {
    const id = await browser.downloads.download({
      url,
      filename: filename.replace(/[/\\]/g, "_"),
      saveAs: false,
      conflictAction: "uniquify",
    });
    return typeof id === "number" ? id : null;
  } catch {
    // Some artifacts redirect through objects.githubusercontent.com; letting
    // the tab navigate is a valid fallback the browser handles natively.
    return null;
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (raw, _sender, sendResponse: (r: MessageResult) => void) => {
      const message = raw as Message;

      const respond = async (): Promise<MessageResult> => {
        switch (message.type) {
          case "ghget:releases": {
            const payload = await enqueue(() =>
              fetchReleases(
                message.owner,
                message.repo,
                message.declaredLatestTag,
                message.force === true,
              ),
            );
            return { ok: true, kind: "releases", payload };
          }
          case "ghget:download": {
            const downloadId = await startDownload(
              message.url,
              message.filename,
            );
            return { ok: true, kind: "download", downloadId };
          }
          case "ghget:settings:get":
            return {
              ok: true,
              kind: "settings",
              settings: await loadSettings(),
            };
          case "ghget:settings:set":
            return {
              ok: true,
              kind: "settings",
              settings: await saveSettings(message.patch),
            };
          case "ghget:cache:clear":
            cache.clear();
            cooldownUntil = 0;
            return { ok: true, kind: "void" };
          default:
            return { ok: false, error: "Unknown message" };
        }
      };

      respond()
        .then(sendResponse)
        .catch((cause: unknown) =>
          sendResponse({
            ok: false,
            error:
              cause instanceof Error ? cause.message : "Background failure",
          }),
        );

      return true; // keep the channel open for the async response
    },
  );
});

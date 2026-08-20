import type { GitHubRelease, RateLimitState } from "./types";

export const API_ROOT = "https://api.github.com";
/**
 * Pinned explicitly. Unversioned requests fall back to the *oldest supported*
 * version once one is retired, which is a silent behaviour change we do not
 * want to inherit.
 */
export const API_VERSION = "2022-11-28";

export interface FetchOptions {
  token?: string | null;
  etag?: string | null;
  signal?: AbortSignal;
}

export interface FetchResult<T> {
  status: number;
  data: T | null;
  etag: string | null;
  notModified: boolean;
  rateLimit: RateLimitState;
  retryAfter: number | null;
  error: string | null;
}

function readRateLimit(
  headers: Headers,
  authenticated: boolean,
): RateLimitState {
  const num = (name: string) => {
    const raw = headers.get(name);
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    limit: num("x-ratelimit-limit"),
    remaining: num("x-ratelimit-remaining"),
    reset: num("x-ratelimit-reset"),
    resource: headers.get("x-ratelimit-resource"),
    authenticated,
  };
}

export async function apiGet<T>(
  path: string,
  options: FetchOptions = {},
): Promise<FetchResult<T>> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.etag) headers["If-None-Match"] = options.etag;

  const authenticated = Boolean(options.token);

  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method: "GET",
      headers,
      // GitHub redirects on renamed repositories; following is documented
      // behaviour rather than an error.
      redirect: "follow",
      signal: options.signal,
    });
  } catch (cause) {
    return {
      status: 0,
      data: null,
      etag: null,
      notModified: false,
      rateLimit: {
        limit: null,
        remaining: null,
        reset: null,
        resource: null,
        authenticated,
      },
      retryAfter: null,
      error: cause instanceof Error ? cause.message : "Network error",
    };
  }

  const rateLimit = readRateLimit(response.headers, authenticated);
  const retryAfterRaw = response.headers.get("retry-after");
  const retryAfter = retryAfterRaw ? Number(retryAfterRaw) : null;

  if (response.status === 304) {
    return {
      status: 304,
      data: null,
      etag: options.etag ?? null,
      notModified: true,
      rateLimit,
      retryAfter,
      error: null,
    };
  }

  if (response.status === 404) {
    return {
      status: 404,
      data: null,
      etag: null,
      notModified: false,
      rateLimit,
      retryAfter,
      error: "Not found",
    };
  }

  if (response.status === 403 || response.status === 429) {
    const exhausted = rateLimit.remaining === 0;
    return {
      status: response.status,
      data: null,
      etag: null,
      notModified: false,
      rateLimit,
      retryAfter,
      error: exhausted ? "rate-limited" : "forbidden",
    };
  }

  if (!response.ok) {
    return {
      status: response.status,
      data: null,
      etag: null,
      notModified: false,
      rateLimit,
      retryAfter,
      error: `GitHub returned ${response.status}`,
    };
  }

  let data: T | null = null;
  try {
    data = (await response.json()) as T;
  } catch {
    return {
      status: response.status,
      data: null,
      etag: null,
      notModified: false,
      rateLimit,
      retryAfter,
      error: "Malformed response",
    };
  }

  return {
    status: response.status,
    data,
    etag: response.headers.get("etag"),
    notModified: false,
    rateLimit,
    retryAfter,
    error: null,
  };
}

export function listReleasesPath(
  owner: string,
  repo: string,
  perPage = 100,
  page = 1,
) {
  const o = encodeURIComponent(owner);
  const r = encodeURIComponent(repo);
  return `/repos/${o}/${r}/releases?per_page=${perPage}&page=${page}`;
}

export function latestReleasePath(owner: string, repo: string) {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/latest`;
}

export type ReleaseList = GitHubRelease[];

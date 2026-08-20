export interface GitHubAsset {
  id: number;
  name: string;
  label: string | null;
  state?: string;
  content_type: string;
  size: number;
  download_count: number;
  created_at: string;
  updated_at: string;
  browser_download_url: string;
  /** Added in newer API versions; format is `sha256:<hex>`. */
  digest?: string | null;
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  immutable?: boolean;
  created_at: string;
  published_at: string | null;
  assets: GitHubAsset[];
  tarball_url: string | null;
  zipball_url: string | null;
}

export interface RateLimitState {
  limit: number | null;
  remaining: number | null;
  reset: number | null;
  resource: string | null;
  authenticated: boolean;
}

export interface ReleasesPayload {
  owner: string;
  repo: string;
  releases: GitHubRelease[];
  declaredLatestTag: string | null;
  fetchedAt: number;
  stale: boolean;
  rateLimited: boolean;
  rateLimit: RateLimitState;
  error: string | null;
}

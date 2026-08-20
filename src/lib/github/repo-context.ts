/**
 * Not every `github.com/a/b` is a repository. These first segments are
 * reserved routes, and matching them would send us fetching nonsense.
 */
const RESERVED_OWNERS = new Set([
  "about",
  "account",
  "apps",
  "codespaces",
  "collections",
  "contact",
  "customer-stories",
  "dashboard",
  "enterprise",
  "events",
  "explore",
  "features",
  "gist",
  "github",
  "githubuniverse",
  "home",
  "issues",
  "join",
  "login",
  "logout",
  "marketplace",
  "new",
  "notifications",
  "orgs",
  "organizations",
  "pricing",
  "pulls",
  "readme",
  "search",
  "security",
  "sessions",
  "settings",
  "signup",
  "site",
  "sponsors",
  "stars",
  "topics",
  "trending",
  "users",
  "watching",
  "codeql",
  "copilot",
  "models",
  "assets",
  "_graphql",
  "_private",
]);

/** Second segments that are user/org sub-pages rather than repositories. */
const RESERVED_REPOS = new Set([
  "settings",
  "sponsors",
  "packages",
  "projects",
]);

export interface RepoRef {
  owner: string;
  repo: string;
  key: string;
}

export function parseRepoFromUrl(href: string): RepoRef | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com")
    return null;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  const [owner, repoRaw] = segments;
  if (RESERVED_OWNERS.has(owner.toLowerCase())) return null;
  if (RESERVED_REPOS.has(repoRaw.toLowerCase())) return null;
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repoRaw)) return null;

  const repo = repoRaw.replace(/\.git$/i, "");
  return { owner, repo, key: `${owner}/${repo}` };
}

/**
 * The repository sidebar always renders the release GitHub itself considers
 * Latest. Reading it costs nothing and saves an API call that would otherwise
 * eat 1/60th of an unauthenticated hourly budget on every page view.
 */
export function scrapeDeclaredLatestTag(ref: RepoRef): string | null {
  const selectors = [
    'a[href*="/releases/tag/"][data-view-component="true"]',
    '.BorderGrid-cell a[href*="/releases/tag/"]',
    'a.Link--primary[href*="/releases/tag/"]',
    'a[href*="/releases/tag/"]',
  ];

  const prefix = `/${ref.owner}/${ref.repo}/releases/tag/`;
  for (const selector of selectors) {
    for (const node of document.querySelectorAll<HTMLAnchorElement>(selector)) {
      const path = new URL(node.href, location.origin).pathname;
      if (!path.startsWith(prefix)) continue;
      const tag = decodeURIComponent(path.slice(prefix.length)).replace(
        /\/$/,
        "",
      );
      if (tag) return tag;
    }
  }
  return null;
}

/** Sidebar language chip - used as a weak hint for source-oriented repos. */
export function scrapePrimaryLanguage(): string | null {
  const node = document.querySelector<HTMLElement>(
    '[data-ga-click*="language"] .color-fg-default, .BorderGrid-cell [itemprop="programmingLanguage"]',
  );
  return node?.textContent?.trim() ?? null;
}

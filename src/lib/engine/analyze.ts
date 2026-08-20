import type { GitHubRelease } from "@/lib/github/types";
import {
  buildPriors,
  classifyRelease,
  type Priors,
  sortReleases,
  summariseProducts,
} from "./release";
import { rankAssets } from "./score";
import type {
  Analysis,
  ClassifiedRelease,
  EngineSettings,
  Notice,
  OS,
  TargetEnv,
} from "./types";
import { OS_LABEL } from "./vocab";

export interface AnalyzeInput {
  owner: string;
  repo: string;
  releases: GitHubRelease[];
  declaredLatestTag: string | null;
  env: TargetEnv;
  settings: EngineSettings;
  stale: boolean;
  rateLimited: boolean;
  error: string | null;
}

export interface AnalysisResult extends Analysis {
  priors: Priors;
  multiProduct: boolean;
}

export function analyze(input: AnalyzeInput): AnalysisResult {
  const notices: Notice[] = [];

  if (input.error) {
    return empty("error", input, notices, input.error);
  }

  // Drafts never reach the public API, but a token-authenticated user will see
  // them and they are not something to hand to a downloader.
  const published = input.releases.filter((r) => r.draft !== true);
  if (published.length === 0) {
    return empty("no-releases", input, notices, null);
  }

  const classified = published.map((release) =>
    classifyRelease(release, {
      owner: input.owner,
      repo: input.repo,
      declaredLatestTag: input.declaredLatestTag,
      includeSourceArchives: input.settings.sourceFallback !== "never",
    }),
  );

  const ordered = sortReleases(classified);
  const priors = buildPriors(ordered);
  const products = summariseProducts(ordered, input.repo);
  const multiProduct = products.length > 1;

  const visible = input.settings.includePrereleases
    ? ordered
    : ordered.filter((r) => r.channel === "stable" || r.isDeclaredLatest);

  const pool = visible.length > 0 ? visible : ordered;
  const withAssets = pool.filter((r) => r.usableAssets.length > 0);

  if (withAssets.length === 0) {
    const anyWithAssets = ordered.find((r) => r.usableAssets.length > 0);
    if (anyWithAssets) {
      notices.push({
        tone: "warn",
        title: "No stable build available",
        detail: `The newest release with downloadable files is ${anyWithAssets.tag} (${anyWithAssets.channel}).`,
      });
      return finish(
        "ok",
        input,
        ordered,
        products,
        priors,
        multiProduct,
        anyWithAssets,
        notices,
      );
    }
    notices.push({
      tone: "info",
      title: "This project publishes releases without binaries",
      detail: "Only the automatically generated source archives are available.",
    });
    return finish(
      "no-usable-assets",
      input,
      ordered,
      products,
      priors,
      multiProduct,
      ordered[0],
      notices,
    );
  }

  // GitHub's declared latest wins whenever it actually carries something.
  const declared = withAssets.find((r) => r.isDeclaredLatest);
  const chosen = declared ?? withAssets[0];

  if (!declared && input.declaredLatestTag) {
    notices.push({
      tone: "info",
      title: `The release GitHub marks as Latest (${input.declaredLatestTag}) has no downloadable files`,
    });
  }
  if (chosen.channel !== "stable") {
    notices.push({
      tone: "warn",
      title: `${chosen.tag} is a ${chosen.channel} release`,
      detail: "No stable release with downloadable files was found.",
    });
  }

  addPlatformGapNotices(chosen, ordered, input.env, notices);

  return finish(
    "ok",
    input,
    ordered,
    products,
    priors,
    multiProduct,
    chosen,
    notices,
  );
}

/**
 * The difference between "latest release" and "latest release *you* can run"
 * is the single most common way a download button lies. When the newest
 * release skipped the user's platform, say so instead of silently serving an
 * older build or nothing at all.
 */
function addPlatformGapNotices(
  chosen: ClassifiedRelease,
  ordered: ClassifiedRelease[],
  env: TargetEnv,
  notices: Notice[],
) {
  if (!env.os) return;
  if (chosen.availableOS.includes(env.os)) return;

  const fallback = ordered.find((r) => r.availableOS.includes(env.os as OS));
  if (fallback) {
    notices.push({
      tone: "warn",
      title: `${chosen.tag} has no ${OS_LABEL[env.os]} build`,
      detail: `The newest ${OS_LABEL[env.os]} build is ${fallback.tag}${
        fallback.channel !== "stable" ? ` (${fallback.channel})` : ""
      }.`,
    });
  } else {
    notices.push({
      tone: "warn",
      title: `No ${OS_LABEL[env.os]} build was found in any release`,
    });
  }
}

export function latestReleaseForOS(
  releases: ClassifiedRelease[],
  os: OS,
  productId: string | null,
): ClassifiedRelease | null {
  for (const release of releases) {
    const match = release.usableAssets.some(
      (a) =>
        a.os === os &&
        (productId === null || (a.product ?? "__default__") === productId),
    );
    if (match) return release;
  }
  return null;
}

export function assetsForOS(
  release: ClassifiedRelease,
  os: OS,
  productId: string | null,
  env: TargetEnv,
  settings: EngineSettings,
  priors: Priors,
) {
  const pool = release.usableAssets.filter(
    (a) =>
      (a.os === os || (a.os === null && os === env.os)) &&
      (productId === null || (a.product ?? "__default__") === productId),
  );
  // Rank as if the user were on that OS but say nothing about their CPU.
  return rankAssets(
    pool,
    { ...env, os, arch: os === env.os ? env.arch : null },
    settings,
    priors,
  );
}

function empty(
  status: Analysis["status"],
  input: AnalyzeInput,
  notices: Notice[],
  error: string | null,
): AnalysisResult {
  return {
    status,
    error,
    stale: input.stale,
    env: input.env,
    releases: [],
    products: [],
    defaultReleaseId: null,
    defaultProductId: null,
    notices,
    priors: new Map(),
    multiProduct: false,
  };
}

function finish(
  status: Analysis["status"],
  input: AnalyzeInput,
  releases: ClassifiedRelease[],
  products: Analysis["products"],
  priors: Priors,
  multiProduct: boolean,
  chosen: ClassifiedRelease | undefined,
  notices: Notice[],
): AnalysisResult {
  if (input.rateLimited) {
    notices.push({
      tone: "warn",
      title: "GitHub API rate limit reached",
      detail:
        "Showing cached data. Add a personal access token in the extension settings to raise the limit.",
    });
  }

  const defaultProduct =
    products.find((p) => p.isPrimary) ?? products[0] ?? null;

  return {
    status: input.rateLimited && status === "ok" ? "ok" : status,
    error: null,
    stale: input.stale,
    env: input.env,
    releases,
    products,
    defaultReleaseId: chosen?.id ?? null,
    defaultProductId: multiProduct
      ? (defaultProduct?.id ?? null)
      : (defaultProduct?.id ?? null),
    notices,
    priors,
    multiProduct,
  };
}

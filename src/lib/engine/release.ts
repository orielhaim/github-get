import type { GitHubRelease } from "@/lib/github/types";
import { classifyAsset, looksLikeApplication, type RawAsset } from "./asset";
import { displayProductName } from "./text";
import type {
  ClassifiedAsset,
  ClassifiedRelease,
  OS,
  ProductSummary,
} from "./types";
import {
  CHANNEL_RANK,
  compareVersions,
  detectChannel,
  parseVersion,
} from "./version";
import { OS_DISPLAY_ORDER } from "./vocab";

export interface ReleaseClassifyOptions {
  owner: string;
  repo: string;
  declaredLatestTag: string | null;
  includeSourceArchives: boolean;
}

/**
 * GitHub attaches source archives to every release whether the maintainer
 * wants them or not, and they are not exposed as assets. They are synthesised
 * here so the UI can offer them explicitly - never as an application download.
 */
function sourceArchives(
  release: GitHubRelease,
  owner: string,
  repo: string,
): RawAsset[] {
  const tag = encodeURIComponent(release.tag_name);
  const base = `https://github.com/${owner}/${repo}/archive/refs/tags/${tag}`;
  return [
    {
      id: `source-zip-${release.id}`,
      name: `${repo}-${release.tag_name}-source.zip`,
      url: `${base}.zip`,
      size: 0,
      downloadCount: 0,
      contentType: "application/zip",
      createdAt: release.published_at ?? release.created_at,
      synthetic: true,
      forcedKind: "source",
    },
    {
      id: `source-tar-${release.id}`,
      name: `${repo}-${release.tag_name}-source.tar.gz`,
      url: `${base}.tar.gz`,
      size: 0,
      downloadCount: 0,
      contentType: "application/gzip",
      createdAt: release.published_at ?? release.created_at,
      synthetic: true,
      forcedKind: "source",
    },
  ];
}

export function classifyRelease(
  release: GitHubRelease,
  options: ReleaseClassifyOptions,
): ClassifiedRelease {
  const tag = release.tag_name ?? "";
  const name = release.name ?? tag;
  const body = release.body ?? "";
  const publishedAt = release.published_at ?? release.created_at;

  const channel = detectChannel(tag, name, release.prerelease === true);
  const version = parseVersion(tag, publishedAt);

  const rawAssets: RawAsset[] = (release.assets ?? [])
    .filter((a) => a.state === "uploaded" || a.state === undefined)
    .map((a) => ({
      id: a.id,
      name: a.name,
      url: a.browser_download_url,
      size: a.size ?? 0,
      downloadCount: a.download_count ?? 0,
      contentType: a.content_type ?? "",
      digest: a.digest ?? null,
      createdAt: a.created_at,
      label: a.label,
    }));

  if (options.includeSourceArchives) {
    rawAssets.push(...sourceArchives(release, options.owner, options.repo));
  }

  const ctx = { repoName: options.repo, tag, releaseBody: body };
  const assets = rawAssets.map((raw) => classifyAsset(raw, ctx));

  applyBodyEvidence(assets, body);
  reconcileProducts(assets, options.repo);

  const usableAssets = assets.filter(looksLikeApplication);
  const products = [
    ...new Set(usableAssets.map((a) => a.product ?? "__default__")),
  ];
  const availableOS = OS_DISPLAY_ORDER.filter((os) =>
    usableAssets.some((a) => a.os === os),
  );

  return {
    id: release.id,
    tag,
    name,
    htmlUrl: release.html_url,
    body,
    draft: release.draft === true,
    prereleaseFlag: release.prerelease === true,
    publishedAt,
    createdAt: release.created_at,
    channel,
    channelRank: CHANNEL_RANK[channel],
    version,
    isDeclaredLatest:
      options.declaredLatestTag !== null && options.declaredLatestTag === tag,
    assets,
    usableAssets,
    products,
    availableOS,
  };
}

/**
 * Release notes are a strong secondary signal: an asset the maintainer names
 * in prose next to a platform word is almost certainly the intended download.
 */
function applyBodyEvidence(assets: ClassifiedAsset[], body: string) {
  if (!body) return;
  const lower = body.toLowerCase();
  for (const asset of assets) {
    if (asset.synthetic) continue;
    const nameLower = asset.name.toLowerCase();
    if (!lower.includes(nameLower)) continue;
    asset.signals.push("mentioned in release notes");
    // Prose mention slightly raises trust in what we parsed out of the name.
    asset.osConfidence = Math.min(1, asset.osConfidence + 0.05);
  }
}

/**
 * The residual slug is only meaningful in contrast with its siblings. If every
 * asset produced the same slug there is one product; if a slug equals the repo
 * name it is the primary product rather than a component.
 */
function reconcileProducts(assets: ClassifiedAsset[], repo: string) {
  const usable = assets.filter(looksLikeApplication);
  const slugs = new Map<string, number>();
  for (const asset of usable) {
    if (!asset.product) continue;
    slugs.set(asset.product, (slugs.get(asset.product) ?? 0) + 1);
  }

  // A slug that appears only once among many is noise from a sloppy filename,
  // not a real product. Fold it into the dominant slug when one exists.
  const dominant = [...slugs.entries()].sort((a, b) => b[1] - a[1])[0];
  const repoSlug = repo.toLowerCase();

  if (slugs.size <= 1) {
    for (const asset of assets) {
      asset.product = null;
      asset.productLabel = null;
    }
    return;
  }

  for (const asset of assets) {
    if (!asset.product) {
      asset.product = dominant ? dominant[0] : null;
      asset.productLabel = asset.product
        ? displayProductName(asset.product)
        : null;
      continue;
    }
    const count = slugs.get(asset.product) ?? 0;
    if (count === 1 && usable.length > 4 && dominant && dominant[1] > 2) {
      asset.signals.push(
        `folded product "${asset.product}" into "${dominant[0]}"`,
      );
      asset.product = dominant[0];
    }
    if (asset.product === repoSlug) asset.product = repoSlug;
    asset.productLabel = displayProductName(asset.product);
  }
}

export function sortReleases(
  releases: ClassifiedRelease[],
): ClassifiedRelease[] {
  return [...releases].sort((a, b) => {
    // GitHub's own "Latest" beats everything we could infer.
    if (a.isDeclaredLatest !== b.isDeclaredLatest)
      return a.isDeclaredLatest ? -1 : 1;
    const byVersion = compareVersions(b.version, a.version);
    if (byVersion !== 0) return byVersion;
    if (a.channelRank !== b.channelRank) return b.channelRank - a.channelRank;
    return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
  });
}

export function summariseProducts(
  releases: ClassifiedRelease[],
  repo: string,
): ProductSummary[] {
  const map = new Map<string, { count: number; os: Set<OS> }>();

  for (const release of releases) {
    for (const asset of release.usableAssets) {
      const id = asset.product ?? "__default__";
      const entry = map.get(id) ?? { count: 0, os: new Set<OS>() };
      entry.count += 1;
      if (asset.os) entry.os.add(asset.os);
      map.set(id, entry);
    }
  }

  const repoSlug = repo.toLowerCase();
  return [...map.entries()]
    .map(([id, entry]) => ({
      id,
      label: id === "__default__" ? repo : displayProductName(id),
      assetCount: entry.count,
      osCoverage: OS_DISPLAY_ORDER.filter((os) => entry.os.has(os)),
      isPrimary: id === "__default__" || id === repoSlug,
    }))
    .sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      if (b.osCoverage.length !== a.osCoverage.length) {
        return b.osCoverage.length - a.osCoverage.length;
      }
      return b.assetCount - a.assetCount;
    });
}

/**
 * Cross-release naming consistency. If the last N releases all shipped
 * `linux|x64|.tar.gz|archive`, an asset with that shape in the newest release
 * is very likely the same artifact - and a one-off shape is more suspect.
 */
export type Priors = Map<string, number>;

export function buildPriors(releases: ClassifiedRelease[]): Priors {
  const counts = new Map<string, number>();
  const considered = releases.slice(0, 10);
  for (const release of considered) {
    const seen = new Set<string>();
    for (const asset of release.usableAssets) {
      if (seen.has(asset.shape)) continue;
      seen.add(asset.shape);
      counts.set(asset.shape, (counts.get(asset.shape) ?? 0) + 1);
    }
  }
  const total = Math.max(1, considered.length);
  const priors: Priors = new Map();
  for (const [shape, count] of counts) priors.set(shape, count / total);
  return priors;
}

import type { Priors } from "./release";
import type {
  Arch,
  ClassifiedAsset,
  ClassifiedRelease,
  EngineSettings,
  OS,
  Recommendation,
  ScoreBreakdown,
  ScoredAsset,
  TargetEnv,
} from "./types";
import { ARCH_LABEL, FORMAT_PREFERENCE, OS_LABEL } from "./vocab";

const KIND_SCORE: Record<string, number> = {
  installer: 1.0,
  package: 0.95,
  binary: 0.88,
  portable: 0.85,
  archive: 0.74,
  unknown: 0.35,
  source: 0.05,
};

/**
 * How well `assetArch` serves a machine running `userArch`. Emulation is
 * allowed but always scores below a native build, so a native option can never
 * lose to a translated one.
 */
function archAffinity(
  userOS: OS | null,
  userArch: Arch | null,
  assetArch: Arch | null,
): number {
  if (assetArch === "universal") return 0.96;
  if (!userArch) return assetArch ? 0.6 : 0.5;
  if (!assetArch) return 0.5;
  if (userArch === assetArch) return 1;

  if (userOS === "macos" && userArch === "arm64" && assetArch === "x64")
    return 0.62; // Rosetta 2
  if (userOS === "windows" && userArch === "arm64" && assetArch === "x64")
    return 0.55;
  if (userOS === "windows" && userArch === "arm64" && assetArch === "x86")
    return 0.38;
  if (userArch === "x64" && assetArch === "x86") return 0.42;
  if (userArch === "arm64" && assetArch === "arm") return 0.34;
  if (userArch === "universal") return 0.6;
  return 0;
}

function osAffinity(userOS: OS | null, assetOS: OS | null): number {
  if (!userOS) return assetOS ? 0.5 : 0.4;
  if (assetOS === userOS) return 1;
  if (assetOS === null) return 0.42;
  return 0;
}

export function scoreAsset(
  asset: ClassifiedAsset,
  env: TargetEnv,
  settings: EngineSettings,
  priors: Priors,
): ScoredAsset {
  const reasons: string[] = [];
  const warnings: string[] = [];

  const breakdown: ScoreBreakdown = {
    os: 0,
    arch: 0,
    kind: 0,
    format: 0,
    libc: 0,
    accelerator: 0,
    runtime: 0,
    popularity: 0,
    prior: 0,
    notes: 0,
    penalty: 0,
  };

  if (asset.excluded) {
    return {
      asset,
      score: 0,
      compatible: false,
      breakdown,
      reasons,
      warnings: [asset.excludeReason ?? "Excluded"],
    };
  }

  const os = osAffinity(env.os, asset.os);
  if (os === 0) {
    return {
      asset,
      score: 0,
      compatible: false,
      breakdown,
      reasons,
      warnings: ["Different platform"],
    };
  }
  breakdown.os = os * 40;
  if (asset.os === env.os) reasons.push(`Built for ${OS_LABEL[asset.os]}`);
  else if (!asset.os) warnings.push("Platform not stated in the filename");

  const arch = archAffinity(env.os, env.arch, asset.arch);
  if (arch === 0) {
    return {
      asset,
      score: 0,
      compatible: false,
      breakdown,
      reasons,
      warnings: ["Different architecture"],
    };
  }
  breakdown.arch = arch * 30;
  if (asset.arch === env.arch && asset.arch)
    reasons.push(`${ARCH_LABEL[asset.arch]} native`);
  else if (asset.arch === "universal") reasons.push("Universal binary");
  else if (arch < 0.7 && asset.arch)
    warnings.push(`${ARCH_LABEL[asset.arch]} build - runs under emulation`);
  else if (!asset.arch)
    warnings.push("Architecture not stated in the filename");

  breakdown.kind = (KIND_SCORE[asset.kind] ?? 0.3) * 14;
  if (asset.kind === "installer") reasons.push("Installer");
  if (asset.kind === "portable") reasons.push("Portable build");

  const table = env.os ? FORMAT_PREFERENCE[env.os] : undefined;
  const formatScore =
    table && asset.extension ? (table[asset.extension] ?? 0.35) : 0.4;
  breakdown.format = formatScore * 12;

  // Respect the user's stated preference rather than assuming everyone wants
  // a system-wide installer.
  if (settings.preferInstaller) {
    if (asset.kind === "installer") breakdown.format += 4;
    if (asset.flags.portable) breakdown.format -= 2;
  } else {
    if (asset.flags.portable || asset.kind === "portable")
      breakdown.format += 5;
    if (asset.kind === "installer") breakdown.format -= 2;
  }

  if (asset.os === "linux") {
    if (asset.libc === "musl") {
      breakdown.libc = settings.preferMusl ? 5 : -2;
      if (!settings.preferMusl)
        warnings.push("musl build - pick this only on Alpine or similar");
    } else if (asset.libc === "gnu") {
      breakdown.libc = settings.preferMusl ? -2 : 4;
    } else if (asset.flags.staticallyLinked) {
      breakdown.libc = 5;
      reasons.push("Statically linked");
    }
    if (asset.distro) {
      breakdown.libc -= 1;
      warnings.push(`Built for ${asset.distro}`);
    }
  }

  if (asset.accelerator) {
    if (asset.accelerator === "cpu") {
      breakdown.accelerator = 3;
      reasons.push("CPU build");
    } else {
      // We cannot know what GPU stack is installed, so never auto-pick one.
      breakdown.accelerator = -4;
      warnings.push(`Requires ${asset.accelerator.toUpperCase()}`);
    }
  }

  if (asset.runtime) {
    breakdown.runtime = asset.flags.selfContained ? 3 : -1;
    if (asset.flags.selfContained) reasons.push("Runtime bundled");
    else warnings.push(`Needs ${asset.runtime.toUpperCase()} installed`);
  }

  // Real-world usage is the best tie-breaker we have between two artifacts
  // that look equally correct on paper.
  if (asset.downloadCount > 0) {
    breakdown.popularity = Math.min(
      7,
      Math.log10(asset.downloadCount + 1) * 2.2,
    );
  }

  const prior = priors.get(asset.shape) ?? 0;
  breakdown.prior = prior * 6;
  if (prior >= 0.6) reasons.push("Matches this project's usual release layout");

  if (asset.signals.includes("mentioned in release notes")) {
    breakdown.notes = 4;
    reasons.push("Named in the release notes");
  }

  if (asset.flags.legacy) {
    breakdown.penalty -= 6;
    warnings.push("Legacy / compatibility build");
  }
  if (asset.flags.unsigned) {
    breakdown.penalty -= 5;
    warnings.push("Unsigned build");
  }
  if (asset.variants.includes("sdk") || asset.variants.includes("tools")) {
    breakdown.penalty -= 3;
  }
  if (asset.size > 0 && asset.size < 20 * 1024 && asset.kind !== "binary") {
    breakdown.penalty -= 4;
    warnings.push("Unusually small file");
  }

  const score = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  return {
    asset,
    score: Math.max(0, score),
    compatible: true,
    breakdown,
    reasons,
    warnings,
  };
}

const MAX_SCORE = 40 + 30 + 14 + 16 + 5 + 3 + 3 + 7 + 6 + 4;

export function rankAssets(
  assets: ClassifiedAsset[],
  env: TargetEnv,
  settings: EngineSettings,
  priors: Priors,
): ScoredAsset[] {
  const scored = assets
    .map((asset) => scoreAsset(asset, env, settings, priors))
    .filter((s) => s.compatible && s.score > 0);

  for (const s of scored) {
    const stem = fileStem(s.asset.name);
    const specialized = scored.some((other) => {
      if (other === s || !sameFamily(s.asset, other.asset)) return false;
      const otherStem = fileStem(other.asset.name);
      return (
        otherStem.startsWith(`${stem}-`) || otherStem.startsWith(`${stem}_`)
      );
    });
    if (specialized) s.score += 8;

    const parent = scored.some((other) => {
      if (other === s || !sameFamily(s.asset, other.asset)) return false;
      const otherStem = fileStem(other.asset.name);
      return (
        stem.startsWith(`${otherStem}-`) || stem.startsWith(`${otherStem}_`)
      );
    });
    if (parent) s.score -= 10;
  }

  return scored.sort((a, b) => b.score - a.score);
}

function fileStem(name: string): string {
  return name.toLowerCase().replace(/\.[a-z0-9.]+$/, "");
}

function sameFamily(a: ClassifiedAsset, b: ClassifiedAsset): boolean {
  return a.os === b.os && a.arch === b.arch && a.extension === b.extension;
}

export function recommend(
  release: ClassifiedRelease,
  productId: string | null,
  env: TargetEnv,
  settings: EngineSettings,
  priors: Priors,
  multiProduct: boolean,
): Recommendation {
  const pool = release.usableAssets.filter((a) =>
    productId === null ? true : (a.product ?? "__default__") === productId,
  );

  const ranked = rankAssets(pool, env, settings, priors);
  if (ranked.length === 0) {
    return {
      level: "none",
      confidence: 0,
      top: null,
      runnersUp: [],
      ambiguities: [],
    };
  }

  const top = ranked[0];
  const second = ranked[1];
  const ambiguities: string[] = [];

  let confidence = Math.min(1, top.score / MAX_SCORE);

  // The absolute score says "this is a good artifact". The margin says "and
  // nothing else is competing with it". Both have to hold for one-click.
  if (second) {
    const margin = (top.score - second.score) / Math.max(1, top.score);
    if (margin < 0.06) {
      confidence *= 0.62;
      ambiguities.push(`"${second.asset.name}" scores almost identically`);
    } else if (margin < 0.14) {
      confidence *= 0.82;
    }
  }

  confidence *= 0.55 + 0.45 * Math.max(env.osConfidence, 0.2);
  if (top.asset.arch === null || top.asset.arch === "universal") {
    confidence *= top.asset.arch === "universal" ? 0.98 : 0.8;
  } else {
    confidence *= 0.6 + 0.4 * Math.max(env.archConfidence, 0.3);
  }

  if (top.warnings.length > 0) confidence *= 0.85;
  if (top.asset.os === null) {
    confidence *= 0.6;
    ambiguities.push("The filename does not state a platform");
  }
  if (multiProduct && productId === null) {
    confidence *= 0.5;
    ambiguities.push("This release ships more than one product");
  }
  if (
    env.os === "linux" &&
    top.asset.libc === null &&
    top.asset.os === "linux"
  ) {
    const hasMuslSibling = pool.some((a) => a.libc === "musl");
    if (hasMuslSibling) ambiguities.push("Both glibc and musl builds exist");
  }

  confidence = Math.max(0, Math.min(1, confidence));

  const level =
    confidence >= settings.autoDownloadThreshold
      ? "auto"
      : confidence >= settings.confirmThreshold
        ? "confirm"
        : "choose";

  return { level, confidence, top, runnersUp: ranked.slice(1, 6), ambiguities };
}

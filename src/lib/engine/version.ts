import type { Channel, ParsedVersion, VersionScheme } from "./types";

const CHANNEL_PATTERNS: Array<{ channel: Channel; re: RegExp }> = [
  {
    channel: "nightly",
    re: /(?<![a-z0-9])(nightly|canary|snapshot|edge|daily)(?![a-z0-9])/i,
  },
  {
    channel: "dev",
    re: /(?<![a-z0-9])(dev|devel|unstable|experimental|insider|next)(?![a-z0-9])/i,
  },
  {
    channel: "alpha",
    re: /(?<![a-z0-9])(alpha|a\d+|preview|pre)(?![a-z0-9])/i,
  },
  { channel: "beta", re: /(?<![a-z0-9])(beta|b\d+|test|testing)(?![a-z0-9])/i },
  {
    channel: "rc",
    re: /(?<![a-z0-9])(rc|releasecandidate|release-candidate|cr)(?![a-z0-9])/i,
  },
];

export const CHANNEL_RANK: Record<Channel, number> = {
  nightly: 0,
  dev: 1,
  alpha: 2,
  beta: 3,
  rc: 4,
  unknown: 4.5,
  stable: 5,
};

export const CHANNEL_LABEL: Record<Channel, string> = {
  stable: "Stable",
  rc: "Release candidate",
  beta: "Beta",
  alpha: "Alpha",
  dev: "Dev",
  nightly: "Nightly",
  unknown: "Unversioned",
};

/**
 * A tag being marked `prerelease: false` on GitHub does not make it stable -
 * plenty of maintainers ship `v2.0.0-beta.3` without ticking the box. Both
 * signals are read, and the more pessimistic one wins.
 */
export function detectChannel(
  tag: string,
  releaseName: string,
  prereleaseFlag: boolean,
): Channel {
  const haystack = `${tag} ${releaseName}`;
  for (const { channel, re } of CHANNEL_PATTERNS) {
    if (re.test(haystack)) return channel;
  }
  return prereleaseFlag ? "beta" : "stable";
}

const SEMVER_RE =
  /(?<![0-9.])(\d{1,6})\.(\d{1,6})(?:\.(\d{1,6}))?(?:\.(\d{1,6}))?(?:[-]([0-9a-zA-Z.-]+))?(?:\+([0-9a-zA-Z.-]+))?(?![0-9.])/;
const CALVER_RE =
  /(?<![0-9])(20\d{2})[.\-_](\d{1,2})(?:[.\-_](\d{1,2}))?(?:[.\-_](\d{1,4}))?(?![0-9])/;
const COMPACT_DATE_RE = /(?<![0-9])(20\d{2})(\d{2})(\d{2})(?![0-9])/;
const NUMERIC_RE = /(?<![0-9])(\d{1,8})(?![0-9])/;

export function parseVersion(
  tag: string,
  fallbackDate?: string,
): ParsedVersion {
  const raw = tag.trim();
  // `foo-cli-v1.2.3`, `release/1.2.3`, `r124` all reduce to the same core.
  const stripped = raw.replace(/^[a-z@/][a-z0-9@/._-]*?[-_/](?=v?\d)/i, "");
  const candidate = stripped.replace(/^v(?=\d)/i, "");

  const semver = SEMVER_RE.exec(candidate);
  if (semver) {
    const core = [semver[1], semver[2], semver[3], semver[4]]
      .filter((x): x is string => x !== undefined)
      .map(Number);
    while (core.length < 3) core.push(0);
    return {
      raw,
      display: normalizeDisplay(raw),
      core,
      prerelease: semver[5] ? semver[5].split(".").filter(Boolean) : [],
      build: semver[6] ?? null,
      scheme: looksCalendar(core) ? "calver" : "semver",
    };
  }

  const calver = CALVER_RE.exec(candidate);
  if (calver) {
    const core = [calver[1], calver[2], calver[3], calver[4]]
      .filter((x): x is string => x !== undefined)
      .map(Number);
    return {
      raw,
      display: normalizeDisplay(raw),
      core,
      prerelease: [],
      build: null,
      scheme: "calver",
    };
  }

  const compact = COMPACT_DATE_RE.exec(candidate);
  if (compact) {
    return {
      raw,
      display: normalizeDisplay(raw),
      core: [Number(compact[1]), Number(compact[2]), Number(compact[3])],
      prerelease: [],
      build: null,
      scheme: "calver",
    };
  }

  const numeric = NUMERIC_RE.exec(candidate);
  if (numeric) {
    return {
      raw,
      display: normalizeDisplay(raw),
      core: [Number(numeric[1])],
      prerelease: [],
      build: null,
      scheme: "numeric",
    };
  }

  // Nothing numeric at all (`latest`, `continuous`, `main`). Fall back to the
  // publish date so ordering stays deterministic.
  const stamp = fallbackDate ? Date.parse(fallbackDate) : Number.NaN;
  return {
    raw,
    display: raw || "unversioned",
    core: Number.isNaN(stamp) ? [] : [stamp],
    prerelease: [],
    build: null,
    scheme: "opaque",
  };
}

function looksCalendar(core: number[]) {
  return (
    core.length >= 2 && core[0] >= 2000 && core[0] <= 2100 && core[1] <= 12
  );
}

function normalizeDisplay(raw: string) {
  const trimmed = raw.trim();
  return trimmed.length > 40 ? `${trimmed.slice(0, 38)}…` : trimmed;
}

const SCHEME_RANK: Record<VersionScheme, number> = {
  semver: 3,
  calver: 3,
  numeric: 2,
  opaque: 1,
};

export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (SCHEME_RANK[a.scheme] !== SCHEME_RANK[b.scheme]) {
    return SCHEME_RANK[a.scheme] - SCHEME_RANK[b.scheme];
  }

  const len = Math.max(a.core.length, b.core.length);
  for (let i = 0; i < len; i += 1) {
    const av = a.core[i] ?? 0;
    const bv = b.core[i] ?? 0;
    if (av !== bv) return av < bv ? -1 : 1;
  }

  // Per semver: a version with a prerelease tail sorts below the plain one.
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1;
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1;

  const plen = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < plen; i += 1) {
    const ai = a.prerelease[i];
    const bi = b.prerelease[i];
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    const an = /^\d+$/.test(ai);
    const bn = /^\d+$/.test(bi);
    if (an && bn) {
      const diff = Number(ai) - Number(bi);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    } else if (an !== bn) {
      return an ? -1 : 1;
    } else {
      const cmp = ai.localeCompare(bi);
      if (cmp !== 0) return cmp < 0 ? -1 : 1;
    }
  }

  return 0;
}

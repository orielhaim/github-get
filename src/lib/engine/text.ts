/**
 * Filenames are matched by masking, not by tokenising on separators.
 *
 * Tokenising breaks on the exact strings that matter: `x86_64` splits into
 * `x86` and `64`, and `arm64-v8a` into three fragments. Instead we run every
 * pattern longest-first over the whole string and blank out what matched, so
 * `x86_64` is consumed before `x86` ever gets a chance to look at it. What is
 * left over after all dictionaries have run is the product name.
 */

const MASK = "\u0001";

export type Strength = "strong" | "weak";

export interface DictEntry<T extends string> {
  id: T;
  strong?: string[];
  weak?: string[];
}

export interface ScanHit<T extends string> {
  id: T;
  pattern: string;
  strength: Strength;
  index: number;
}

export interface ScanResult<T extends string> {
  hits: ScanHit<T>[];
  residual: string;
}

const CONFIDENCE: Record<Strength, number> = { strong: 0.95, weak: 0.55 };

export function strengthConfidence(strength: Strength) {
  return CONFIDENCE[strength];
}

function boundaryRe(pattern: string) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "g");
}

/** Lowercase, strip diacritics, and unify every separator family to `-`. */
export function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_+()[\]{}~,]/g, "-");
}

export function scan<T extends string>(
  haystack: string,
  dict: DictEntry<T>[],
): ScanResult<T> {
  const flat: Array<{ id: T; pattern: string; strength: Strength }> = [];
  for (const entry of dict) {
    for (const p of entry.strong ?? [])
      flat.push({ id: entry.id, pattern: p, strength: "strong" });
    for (const p of entry.weak ?? [])
      flat.push({ id: entry.id, pattern: p, strength: "weak" });
  }
  // Longest first is what makes masking correct.
  flat.sort((a, b) => b.pattern.length - a.pattern.length);

  let work = haystack;
  const hits: ScanHit<T>[] = [];

  for (const item of flat) {
    const re = boundaryRe(item.pattern);
    let match: RegExpExecArray | null;
    while ((match = re.exec(work)) !== null) {
      hits.push({
        id: item.id,
        pattern: item.pattern,
        strength: item.strength,
        index: match.index,
      });
      // Replacement is the same length, so every index stays valid.
      work =
        work.slice(0, match.index) +
        MASK.repeat(match[0].length) +
        work.slice(match.index + match[0].length);
      re.lastIndex = match.index + match[0].length;
    }
  }

  hits.sort((a, b) => a.index - b.index);
  return { hits, residual: work };
}

/** Blank a literal substring so later passes cannot see it. */
export function maskLiteral(haystack: string, literal: string): string {
  if (!literal) return haystack;
  const idx = haystack.indexOf(literal);
  if (idx === -1) return haystack;
  return (
    haystack.slice(0, idx) +
    MASK.repeat(literal.length) +
    haystack.slice(idx + literal.length)
  );
}

export function maskRange(
  haystack: string,
  index: number,
  length: number,
): string {
  return (
    haystack.slice(0, index) +
    MASK.repeat(length) +
    haystack.slice(index + length)
  );
}

/**
 * Picks the winner from a set of hits: strong beats weak, then earlier
 * position wins (platform info is usually a suffix, but the first strong
 * signal is the more reliable one in practice for products like `foo-cli`).
 */
export function resolveHit<T extends string>(
  hits: ScanHit<T>[],
): { id: T; confidence: number } | null {
  if (hits.length === 0) return null;

  const byId = new Map<T, { strong: number; weak: number; first: number }>();
  for (const hit of hits) {
    const entry = byId.get(hit.id) ?? { strong: 0, weak: 0, first: hit.index };
    if (hit.strength === "strong") entry.strong += 1;
    else entry.weak += 1;
    entry.first = Math.min(entry.first, hit.index);
    byId.set(hit.id, entry);
  }

  const ranked = [...byId.entries()].sort((a, b) => {
    if (a[1].strong !== b[1].strong) return b[1].strong - a[1].strong;
    if (a[1].weak !== b[1].weak) return b[1].weak - a[1].weak;
    return a[1].first - b[1].first;
  });

  const [id, stats] = ranked[0];
  const contested = ranked.length > 1 && ranked[1][1].strong === stats.strong;
  const base = stats.strong > 0 ? CONFIDENCE.strong : CONFIDENCE.weak;
  return { id, confidence: contested ? base * 0.7 : base };
}

export function residualSlug(residual: string): string | null {
  const cleaned = residual
    .replace(new RegExp(`${MASK}+`, "g"), "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!cleaned) return null;

  const parts = cleaned
    .split("-")
    .filter((p) => p.length > 1 && !/^\d+$/.test(p))
    // Junk words that survive every dictionary but name nothing.
    .filter((p) => !GENERIC_WORDS.has(p));

  if (parts.length === 0) return null;
  return parts.join("-");
}

const GENERIC_WORDS = new Set([
  "release",
  "releases",
  "build",
  "builds",
  "dist",
  "final",
  "package",
  "packages",
  "bundle",
  "archive",
  "artifact",
  "artifacts",
  "output",
  "out",
  "bin",
  "binaries",
  "binary",
  "app",
  "application",
  "setup",
  "installer",
  "install",
  "portable",
  "standalone",
  "full",
  "latest",
  "stable",
  "signed",
  "prod",
  "production",
  "baseline",
]);

export function titleCase(slug: string): string {
  return slug
    .split(/[-]/)
    .filter(Boolean)
    .map((part) =>
      part.length <= 3 && part === part.toLowerCase()
        ? part.toUpperCase()
        : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ");
}

const ARCH_WORD =
  /^(aarch\d*|arm64(?:e|ec)?|armv?\d+[a-z]*|armeabi(?:-v7a)?|x86_64|amd64|i[3-6]86|ia32|x64|x86|riscv(?:64)?(?:gc)?|ppc64(?:le)?|s390x?|mips(?:64)?(?:el|le)?|loong(?:arch)?64|sparc64|universal(?:2)?)$/i;

/** Product names from filenames. Keep architecture tokens lowercase. */
export function displayProductName(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) =>
      ARCH_WORD.test(part) ? part.toLowerCase() : titleCase(part),
    )
    .join(" ");
}

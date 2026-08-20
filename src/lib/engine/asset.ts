import {
  displayProductName,
  maskLiteral,
  normalize,
  residualSlug,
  resolveHit,
  scan,
} from "./text";
import type {
  Accelerator,
  Arch,
  AssetFlags,
  AssetKind,
  ClassifiedAsset,
  Libc,
  OS,
  Runtime,
} from "./types";
import {
  ACCELERATOR_DICT,
  ARCH_DICT,
  DISTRO_DICT,
  EXTENSION_OS,
  EXTENSIONS,
  LIBC_DICT,
  OS_DICT,
  RUNTIME_DICT,
} from "./vocab";

export interface RawAsset {
  id: number | string;
  name: string;
  url: string;
  size: number;
  downloadCount: number;
  contentType: string;
  digest?: string | null;
  createdAt: string;
  label?: string | null;
  synthetic?: boolean;
  forcedKind?: AssetKind;
}

const SIGNATURE_EXT = new Set([
  ".sig",
  ".asc",
  ".gpg",
  ".pem",
  ".crt",
  ".cert",
  ".p7s",
  ".minisig",
  ".sigstore",
]);
const CHECKSUM_EXT = new Set([
  ".sha256sum",
  ".sha512sum",
  ".sha256",
  ".sha512",
  ".sha1",
  ".md5",
  ".sum",
  ".digest",
]);
const SYMBOL_EXT = new Set([
  ".pdb",
  ".dsym",
  ".dsym.zip",
  ".sym",
  ".dwp",
  ".debug",
  ".map",
  ".symbols.zip",
]);
const SBOM_EXT = new Set([
  ".spdx.json",
  ".cdx.json",
  ".sbom.json",
  ".spdx",
  ".cdx",
  ".intoto.jsonl",
  ".att",
  ".sarif",
]);
const DOC_EXT = new Set([".md", ".pdf", ".html"]);
const METADATA_EXT = new Set([
  ".blockmap",
  ".yml",
  ".yaml",
  ".xml",
  ".plist",
  ".nupkg",
]);
const ARCHIVE_EXT = new Set([
  ".zip",
  ".7z",
  ".rar",
  ".tar",
  ".tar.gz",
  ".tar.xz",
  ".tar.bz2",
  ".tar.zst",
  ".tar.lz4",
  ".tar.br",
  ".tar.lz",
  ".tgz",
  ".txz",
  ".tbz2",
  ".gz",
  ".xz",
  ".bz2",
  ".zst",
  ".lz4",
]);
const INSTALLER_EXT = new Set([
  ".msi",
  ".msix",
  ".msixbundle",
  ".appx",
  ".appxbundle",
  ".appinstaller",
  ".dmg",
  ".pkg",
  ".deb",
  ".rpm",
  ".snap",
  ".flatpak",
  ".flatpakref",
  ".apk",
  ".ipa",
  ".pkg.tar.zst",
  ".pkg.tar.xz",
  ".pkg.tar.gz",
  ".run",
]);
const BINARY_EXT = new Set([
  ".exe",
  ".appimage",
  ".app",
  ".bin",
  ".elf",
  ".wasm",
  ".uf2",
  ".hex",
  ".srec",
  ".so",
  ".dll",
  ".dylib",
  ".ko",
  ".jar",
  ".vsix",
  ".xpi",
  ".crx",
]);

const CHECKSUM_NAME_RE =
  /(?<![a-z0-9])(checksums?|sha256sums?|sha512sums?|shasums?|md5sums?|hashes|digests)(?![a-z0-9])/;
const SBOM_NAME_RE =
  /(?<![a-z0-9])(sbom|provenance|attestation|slsa|spdx|cyclonedx)(?![a-z0-9])/;
const SYMBOL_NAME_RE =
  /(?<![a-z0-9])(symbols?|debuginfo|dbgsym|dbg|pdbs)(?![a-z0-9])/;
const SOURCE_NAME_RE =
  /(?<![a-z0-9])(source|sources|src|srcs|source-code|full-source)(?![a-z0-9])/;
const METADATA_NAME_RE =
  /(?<![a-z0-9])(latest|latest-mac|latest-linux|releases|appcast|update|manifest|metadata|index)(?![a-z0-9])/;
const DOC_NAME_RE =
  /(?<![a-z0-9])(readme|license|licence|changelog|notice|docs?|manual|third-party)(?![a-z0-9])/;
const INSTALLER_NAME_RE =
  /(?<![a-z0-9])(setup|installer|install|web-?setup|online-?installer)(?![a-z0-9])/;
const PORTABLE_NAME_RE =
  /(?<![a-z0-9])(portable|standalone|no-?install|nosetup|xcopy)(?![a-z0-9])/;
const DEBUG_NAME_RE =
  /(?<![a-z0-9])(debug|dbg|asan|msan|tsan|ubsan|profiling|coverage)(?![a-z0-9])/;
const UNSIGNED_NAME_RE =
  /(?<![a-z0-9])(unsigned|nosign|no-?notariz\w*|unnotarized)(?![a-z0-9])/;
const LEGACY_NAME_RE =
  /(?<![a-z0-9])(legacy|old|compat|deprecated|win7|win8|xp|vista|sse2|nonavx|noavx2?|baseline)(?![a-z0-9])/;
const UNPACKED_RE =
  /(?<![a-z0-9])(unpacked|unzipped|raw|intermediate)(?![a-z0-9])/;
const STATIC_RE = /(?<![a-z0-9])(static|fully-static|staticlib)(?![a-z0-9])/;
const DELTA_RE = /(?<![a-z0-9])(delta|patch|incremental|nupkg)(?![a-z0-9])/;
const CONTAINER_RE =
  /(?<![a-z0-9])(docker|oci|container|image|singularity|apptainer)(?![a-z0-9])/;
const VERSIONISH_RE =
  /(?<![a-z])v?\d+(?:[.\-_]\d+){0,4}(?:[.-][0-9a-z]+)?(?![a-z])/g;

export function splitExtension(name: string): {
  stem: string;
  extension: string | null;
} {
  const lower = name.toLowerCase();
  for (const ext of EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return { stem: name.slice(0, name.length - ext.length), extension: ext };
    }
  }
  return { stem: name, extension: null };
}

/**
 * A double extension like `foo.tar.gz.sha256` must classify as a checksum, not
 * as a tarball, so the trailing extension is peeled first and remembered.
 */
function peelGuardExtension(name: string): {
  guard: string | null;
  base: string;
} {
  const lower = name.toLowerCase();
  for (const ext of EXTENSIONS) {
    if (!lower.endsWith(ext)) continue;
    if (SIGNATURE_EXT.has(ext) || CHECKSUM_EXT.has(ext)) {
      return { guard: ext, base: name.slice(0, name.length - ext.length) };
    }
    break;
  }
  return { guard: null, base: name };
}

export interface ClassifyContext {
  repoName: string;
  tag: string;
  releaseBody: string;
}

export function classifyAsset(
  raw: RawAsset,
  ctx: ClassifyContext,
): ClassifiedAsset {
  const signals: string[] = [];
  const { guard, base } = peelGuardExtension(raw.name);
  const { stem, extension } = splitExtension(base);

  const effectiveExtension = guard ?? extension;
  let work = normalize(stem);

  // Strip the tag and repo name before dictionary work: `v1.2.3` in the middle
  // of a filename is not architecture information, and a repo called `arm-tool`
  // would otherwise poison every asset it ships.
  work = maskLiteral(work, normalize(ctx.tag));
  work = maskLiteral(work, normalize(ctx.tag.replace(/^v/i, "")));
  if (ctx.repoName.length > 3)
    work = maskLiteral(work, normalize(ctx.repoName));
  work = work.replace(VERSIONISH_RE, (m) => "\u0001".repeat(m.length));

  const nameLower = normalize(raw.name);

  const osScan = scan(work, OS_DICT);
  work = osScan.residual;
  const distroScan = scan(work, DISTRO_DICT);
  work = distroScan.residual;
  const archScan = scan(work, ARCH_DICT);
  work = archScan.residual;
  const libcScan = scan(work, LIBC_DICT);
  work = libcScan.residual;
  const accelScan = scan(work, ACCELERATOR_DICT);
  work = accelScan.residual;
  const runtimeScan = scan(work, RUNTIME_DICT);
  work = runtimeScan.residual;

  const osHit = resolveHit(osScan.hits);
  const distroHit = resolveHit(distroScan.hits);
  const archHit = resolveHit(archScan.hits);
  const libcHit = resolveHit(libcScan.hits);
  const accelHit = resolveHit(accelScan.hits);
  const runtimeHit = resolveHit(runtimeScan.hits);

  let os: OS | null = osHit?.id ?? null;
  let osConfidence = osHit?.confidence ?? 0;

  const extOS = effectiveExtension
    ? EXTENSION_OS[effectiveExtension]
    : undefined;
  if (extOS) {
    if (!os) {
      os = extOS;
      osConfidence = 0.9;
      signals.push(`os inferred from ${effectiveExtension}`);
    } else if (os !== extOS) {
      // The extension is a harder constraint than a stray word in the name.
      signals.push(
        `name says ${os}, extension says ${extOS} - trusting extension`,
      );
      os = extOS;
      osConfidence = 0.85;
    } else {
      osConfidence = Math.min(1, osConfidence + 0.1);
    }
  }

  if (!os && distroHit) {
    os = "linux";
    osConfidence = 0.9;
    signals.push(`os inferred from distro ${distroHit.id}`);
  }
  if (!os && libcHit?.id === "musl") {
    os = "linux";
    osConfidence = 0.75;
    signals.push("os inferred from musl");
  }

  let arch: Arch | null = archHit?.id ?? null;
  let archConfidence = archHit?.confidence ?? 0;

  // `intel` and `silicon` only mean an architecture on macOS.
  if (arch && os !== "macos") {
    const weakMac = archScan.hits.every(
      (h) => h.strength === "weak" && /intel|silicon|m[1-4]/.test(h.pattern),
    );
    if (weakMac) {
      arch = null;
      archConfidence = 0;
    }
  }
  if (!arch && os === "macos" && /universal/.test(nameLower)) {
    arch = "universal";
    archConfidence = 0.9;
  }

  const libc: Libc | null = os === "linux" ? (libcHit?.id ?? null) : null;
  const accelerator: Accelerator | null = accelHit?.id ?? null;
  const runtime: Runtime | null = runtimeHit?.id ?? null;

  const flags: AssetFlags = {
    installer: INSTALLER_NAME_RE.test(nameLower),
    portable: PORTABLE_NAME_RE.test(nameLower),
    staticallyLinked: STATIC_RE.test(nameLower),
    debug: DEBUG_NAME_RE.test(nameLower),
    unsigned: UNSIGNED_NAME_RE.test(nameLower),
    legacy: LEGACY_NAME_RE.test(nameLower),
    universal: arch === "universal",
    unpacked: UNPACKED_RE.test(nameLower),
    selfContained: /self-contained|bundled|with-(jre|jdk|runtime|deps)/.test(
      nameLower,
    ),
    delta: DELTA_RE.test(nameLower),
  };

  const kind =
    raw.forcedKind ??
    classifyKind({
      nameLower,
      extension: effectiveExtension,
      guard,
      flags,
      size: raw.size,
      contentType: raw.contentType,
    });

  const product = residualSlug(work);
  const variants = collectVariants(work, nameLower);

  const { excluded, excludeReason } = decideExclusion(kind, flags, raw);

  if (osHit) signals.push(`os:${osHit.id}`);
  if (archHit) signals.push(`arch:${archHit.id}`);
  if (libc) signals.push(`libc:${libc}`);
  if (accelerator) signals.push(`accel:${accelerator}`);
  if (runtime) signals.push(`runtime:${runtime}`);
  signals.push(`kind:${kind}`);

  return {
    id: String(raw.id),
    name: raw.name,
    url: raw.url,
    size: raw.size,
    downloadCount: raw.downloadCount,
    contentType: raw.contentType,
    digest: raw.digest ?? null,
    createdAt: raw.createdAt,
    os,
    osConfidence,
    arch,
    archConfidence,
    extension: effectiveExtension,
    kind,
    libc,
    accelerator,
    runtime,
    distro: distroHit?.id ?? null,
    product,
    productLabel: product ? displayProductName(product) : null,
    variants,
    flags,
    shape: [os ?? "?", arch ?? "?", effectiveExtension ?? "?", kind].join("|"),
    signals,
    excluded,
    excludeReason,
    synthetic: raw.synthetic === true,
  };
}

interface KindInput {
  nameLower: string;
  extension: string | null;
  guard: string | null;
  flags: AssetFlags;
  size: number;
  contentType: string;
}

function classifyKind(input: KindInput): AssetKind {
  const { nameLower, extension, guard, flags, size } = input;

  if (guard && SIGNATURE_EXT.has(guard)) return "signature";
  if (guard && CHECKSUM_EXT.has(guard)) return "checksum";
  if (extension && SIGNATURE_EXT.has(extension)) return "signature";
  if (extension && CHECKSUM_EXT.has(extension)) return "checksum";
  if (CHECKSUM_NAME_RE.test(nameLower)) return "checksum";
  if (extension && SBOM_EXT.has(extension)) return "sbom";
  if (SBOM_NAME_RE.test(nameLower)) return "sbom";
  if (extension && SYMBOL_EXT.has(extension)) return "symbols";
  if (SYMBOL_NAME_RE.test(nameLower)) return "symbols";
  if (extension && DOC_EXT.has(extension)) return "documentation";
  if (DOC_NAME_RE.test(nameLower) && (!extension || extension === ".txt"))
    return "documentation";
  if (extension === ".nupkg" || flags.delta) return "metadata";
  if (extension && METADATA_EXT.has(extension)) {
    // A tiny yml/json next to installers is an update manifest, not a product.
    return "metadata";
  }
  if (!extension && METADATA_NAME_RE.test(nameLower) && size < 64 * 1024)
    return "metadata";
  if (CONTAINER_RE.test(nameLower) || extension === ".sif") return "container";
  if (SOURCE_NAME_RE.test(nameLower)) return "source";

  if (extension && INSTALLER_EXT.has(extension)) return "installer";
  if (extension === ".exe") return flags.installer ? "installer" : "binary";
  if (extension && BINARY_EXT.has(extension)) return "binary";
  if (extension && ARCHIVE_EXT.has(extension)) {
    return flags.portable ? "portable" : "archive";
  }
  if (!extension) return "binary";

  return "unknown";
}

function decideExclusion(kind: AssetKind, flags: AssetFlags, raw: RawAsset) {
  if (kind === "checksum")
    return { excluded: true, excludeReason: "Checksum file" };
  if (kind === "signature")
    return { excluded: true, excludeReason: "Signature file" };
  if (kind === "sbom")
    return { excluded: true, excludeReason: "SBOM / provenance" };
  if (kind === "symbols")
    return { excluded: true, excludeReason: "Debug symbols" };
  if (kind === "metadata")
    return { excluded: true, excludeReason: "Update metadata" };
  if (kind === "documentation")
    return { excluded: true, excludeReason: "Documentation" };
  if (kind === "container")
    return { excluded: true, excludeReason: "Container image" };
  if (flags.unpacked)
    return { excluded: true, excludeReason: "Unpacked build output" };
  if (flags.debug) return { excluded: true, excludeReason: "Debug build" };
  if (raw.size > 0 && raw.size < 512 && kind !== "binary") {
    return { excluded: true, excludeReason: "Suspiciously small" };
  }
  return { excluded: false, excludeReason: null };
}

const VARIANT_RE =
  /(?<![a-z0-9])(gtk[234]?|qt[56]?|x11|wayland|headless|server|client|full|lite|slim|minimal|desktop|mobile|console|gui|cli|tui|daemon|agent|sdk|dev|tools|extras|plugins?|lang|i18n|nogui|no-?deps|vulkan|opengl|directx)(?![a-z0-9])/g;

function collectVariants(residual: string, nameLower: string): string[] {
  const found = new Set<string>();
  for (const match of nameLower.matchAll(VARIANT_RE)) found.add(match[1]);
  void residual;
  return [...found];
}

export function looksLikeApplication(asset: ClassifiedAsset): boolean {
  if (asset.excluded) return false;
  return (
    asset.kind === "installer" ||
    asset.kind === "package" ||
    asset.kind === "portable" ||
    asset.kind === "binary" ||
    asset.kind === "archive"
  );
}

/**
 * The dimensions an artifact can vary along. Kept deliberately separate:
 * a flat "platform" string cannot express "linux x64 musl cuda12 cli".
 */

export type OS =
  | "windows"
  | "macos"
  | "linux"
  | "android"
  | "ios"
  | "freebsd"
  | "openbsd"
  | "netbsd"
  | "solaris"
  | "wasm";

export type Arch =
  | "x64"
  | "x86"
  | "arm64"
  | "arm"
  | "riscv64"
  | "ppc64le"
  | "ppc64"
  | "s390x"
  | "mips64"
  | "mips"
  | "loong64"
  | "sparc64"
  | "universal";

export type Libc = "gnu" | "musl" | "uclibc";

export type Accelerator =
  | "cpu"
  | "cuda"
  | "rocm"
  | "hip"
  | "vulkan"
  | "metal"
  | "opencl"
  | "directml"
  | "openvino"
  | "sycl"
  | "npu";

export type Runtime =
  | "jre"
  | "jdk"
  | "dotnet"
  | "node"
  | "python"
  | "electron"
  | "mono";

export type AssetKind =
  | "installer"
  | "package"
  | "portable"
  | "binary"
  | "archive"
  | "source"
  | "checksum"
  | "signature"
  | "sbom"
  | "symbols"
  | "metadata"
  | "container"
  | "documentation"
  | "unknown";

export type Channel =
  | "stable"
  | "rc"
  | "beta"
  | "alpha"
  | "dev"
  | "nightly"
  | "unknown";

export type VersionScheme = "semver" | "calver" | "numeric" | "opaque";

export const DESIRABLE_KINDS: AssetKind[] = [
  "installer",
  "package",
  "portable",
  "binary",
  "archive",
];

/** Never a primary download, no matter how well it matches the platform. */
export const EXCLUDED_KINDS: AssetKind[] = [
  "checksum",
  "signature",
  "sbom",
  "symbols",
  "metadata",
  "documentation",
];

export interface ParsedVersion {
  raw: string;
  display: string;
  core: number[];
  prerelease: string[];
  build: string | null;
  scheme: VersionScheme;
}

export interface AssetFlags {
  installer: boolean;
  portable: boolean;
  staticallyLinked: boolean;
  debug: boolean;
  unsigned: boolean;
  legacy: boolean;
  universal: boolean;
  unpacked: boolean;
  selfContained: boolean;
  delta: boolean;
}

export interface ClassifiedAsset {
  id: string;
  name: string;
  url: string;
  size: number;
  downloadCount: number;
  contentType: string;
  digest: string | null;
  createdAt: string;

  os: OS | null;
  osConfidence: number;
  arch: Arch | null;
  archConfidence: number;

  extension: string | null;
  kind: AssetKind;
  libc: Libc | null;
  accelerator: Accelerator | null;
  runtime: Runtime | null;
  distro: string | null;

  /** Slug of whatever is left after stripping every recognised dimension. */
  product: string | null;
  productLabel: string | null;

  variants: string[];
  flags: AssetFlags;

  /** Stable signature used for cross-release consistency learning. */
  shape: string;

  signals: string[];
  excluded: boolean;
  excludeReason: string | null;
  synthetic: boolean;
}

export interface ClassifiedRelease {
  id: number;
  tag: string;
  name: string;
  htmlUrl: string;
  body: string;
  draft: boolean;
  prereleaseFlag: boolean;
  publishedAt: string;
  createdAt: string;

  channel: Channel;
  channelRank: number;
  version: ParsedVersion;
  isDeclaredLatest: boolean;

  assets: ClassifiedAsset[];
  /** Assets that could plausibly be an application download. */
  usableAssets: ClassifiedAsset[];
  products: string[];
  availableOS: OS[];
}

export interface TargetEnv {
  os: OS | null;
  arch: Arch | null;
  libc: Libc | null;
  osConfidence: number;
  archConfidence: number;
  source: string;
  notes: string[];
}

export interface EngineSettings {
  includePrereleases: boolean;
  preferInstaller: boolean;
  preferMusl: boolean;
  sourceFallback: "auto" | "always" | "never";
  autoDownloadThreshold: number;
  confirmThreshold: number;
}

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  includePrereleases: false,
  preferInstaller: true,
  preferMusl: false,
  sourceFallback: "auto",
  autoDownloadThreshold: 0.82,
  confirmThreshold: 0.6,
};

export interface ScoreBreakdown {
  os: number;
  arch: number;
  kind: number;
  format: number;
  libc: number;
  accelerator: number;
  runtime: number;
  popularity: number;
  prior: number;
  notes: number;
  penalty: number;
}

export interface ScoredAsset {
  asset: ClassifiedAsset;
  score: number;
  compatible: boolean;
  breakdown: ScoreBreakdown;
  reasons: string[];
  warnings: string[];
}

export type RecommendationLevel = "auto" | "confirm" | "choose" | "none";

export interface Recommendation {
  level: RecommendationLevel;
  confidence: number;
  top: ScoredAsset | null;
  runnersUp: ScoredAsset[];
  ambiguities: string[];
}

export interface ProductSummary {
  id: string;
  label: string;
  assetCount: number;
  osCoverage: OS[];
  /** True when the residual slug matched the repository name. */
  isPrimary: boolean;
}

export type NoticeTone = "info" | "warn";

export interface Notice {
  tone: NoticeTone;
  title: string;
  detail?: string;
}

export type AnalysisStatus =
  | "ok"
  | "no-releases"
  | "no-usable-assets"
  | "rate-limited"
  | "error";

export interface Analysis {
  status: AnalysisStatus;
  error: string | null;
  stale: boolean;
  env: TargetEnv;
  releases: ClassifiedRelease[];
  products: ProductSummary[];
  defaultReleaseId: number | null;
  defaultProductId: string | null;
  notices: Notice[];
}

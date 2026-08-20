import type { Arch, Libc, OS, TargetEnv } from "./types";

interface UADataLike {
  platform?: string;
  mobile?: boolean;
  getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
}

/**
 * Browsers deliberately blur architecture. This returns a confidence rather
 * than a verdict, and the UI degrades to an explicit picker when it is low -
 * shipping the wrong binary is far worse than asking one question.
 */
export async function detectEnvironment(): Promise<TargetEnv> {
  const notes: string[] = [];
  const ua = navigator.userAgent ?? "";
  const uaData = (navigator as Navigator & { userAgentData?: UADataLike })
    .userAgentData;

  let os: OS | null = null;
  let arch: Arch | null = null;
  let osConfidence = 0;
  let archConfidence = 0;
  let source = "user-agent";

  if (uaData?.getHighEntropyValues) {
    try {
      const high = await uaData.getHighEntropyValues([
        "architecture",
        "bitness",
        "platform",
        "platformVersion",
        "model",
        "wow64",
      ]);
      source = "user-agent client hints";
      const platform = String(high.platform ?? uaData.platform ?? "");
      os = mapPlatform(platform);
      if (os) osConfidence = 0.95;

      const architecture = String(high.architecture ?? "");
      const bitness = String(high.bitness ?? "");
      const wow64 = high.wow64 === true;

      if (architecture === "arm") {
        arch = bitness === "64" ? "arm64" : "arm";
        archConfidence = 0.92;
      } else if (architecture === "x86") {
        arch = bitness === "64" || wow64 ? "x64" : "x86";
        archConfidence = wow64 ? 0.8 : 0.92;
        if (wow64)
          notes.push("32-bit browser on 64-bit Windows - offering x64.");
      } else if (architecture) {
        arch = mapArchToken(architecture);
        archConfidence = arch ? 0.85 : 0;
      }
    } catch {
      notes.push("Client hints were refused by the browser.");
    }
  }

  if (!os) {
    os = mapUserAgent(ua, uaData?.platform);
    osConfidence = os ? 0.8 : 0;
  }

  if (!arch) {
    const guess = archFromUserAgent(ua);
    if (guess) {
      arch = guess.arch;
      archConfidence = guess.confidence;
    }
  }

  // Safari and Firefox on Apple Silicon still report an Intel UA. The GPU
  // renderer string is the only reliable in-page tell.
  if (os === "macos" && (!arch || arch === "x64") && archConfidence < 0.9) {
    const renderer = probeRenderer();
    if (renderer && /apple\s*(m\d|gpu|silicon)/i.test(renderer)) {
      arch = "arm64";
      archConfidence = 0.82;
      notes.push("Apple Silicon detected from the GPU renderer string.");
    } else if (arch === "x64" && archConfidence < 0.6) {
      notes.push(
        "macOS reports an Intel user agent on every Mac - verify the architecture.",
      );
    }
  }

  if (os === "macos" && !arch) {
    arch = "universal";
    archConfidence = 0.3;
  }

  const libc: Libc | null = os === "linux" ? null : null;
  if (os === "linux") {
    notes.push("glibc vs musl cannot be detected from a browser.");
  }

  return {
    os,
    arch,
    libc,
    osConfidence,
    archConfidence,
    source,
    notes,
  };
}

function mapPlatform(platform: string): OS | null {
  const p = platform.toLowerCase();
  if (p.includes("win")) return "windows";
  if (p.includes("mac")) return "macos";
  if (p.includes("android")) return "android";
  if (p.includes("ios") || p.includes("iphone") || p.includes("ipad"))
    return "ios";
  if (p.includes("chrome os") || p.includes("chromeos")) return "linux";
  if (p.includes("linux")) return "linux";
  if (p.includes("freebsd")) return "freebsd";
  if (p.includes("openbsd")) return "openbsd";
  return null;
}

function mapUserAgent(ua: string, platform?: string): OS | null {
  const s = `${ua} ${platform ?? ""}`.toLowerCase();
  if (/android/.test(s)) return "android";
  if (/iphone|ipad|ipod/.test(s)) return "ios";
  if (/windows|win32|win64/.test(s)) return "windows";
  if (/mac os x|macintosh/.test(s)) {
    // iPadOS lies and calls itself a Mac; touch points give it away.
    if (navigator.maxTouchPoints > 2) return "ios";
    return "macos";
  }
  if (/cros/.test(s)) return "linux";
  if (/freebsd/.test(s)) return "freebsd";
  if (/openbsd/.test(s)) return "openbsd";
  if (/netbsd/.test(s)) return "netbsd";
  if (/sunos|solaris/.test(s)) return "solaris";
  if (/linux|x11/.test(s)) return "linux";
  return null;
}

function archFromUserAgent(
  ua: string,
): { arch: Arch; confidence: number } | null {
  const s = ua.toLowerCase();
  if (/aarch64|arm64/.test(s)) return { arch: "arm64", confidence: 0.88 };
  if (/armv8/.test(s)) return { arch: "arm64", confidence: 0.8 };
  if (/armv7|armv6|arm\b/.test(s)) return { arch: "arm", confidence: 0.8 };
  if (/x86_64|win64|wow64|amd64/.test(s))
    return { arch: "x64", confidence: 0.85 };
  if (/riscv64/.test(s)) return { arch: "riscv64", confidence: 0.85 };
  if (/ppc64le/.test(s)) return { arch: "ppc64le", confidence: 0.85 };
  if (/i686|i386|x86/.test(s)) return { arch: "x86", confidence: 0.6 };
  return null;
}

function mapArchToken(token: string): Arch | null {
  const t = token.toLowerCase();
  if (t.includes("arm")) return "arm64";
  if (t.includes("x86") || t.includes("amd")) return "x64";
  if (t.includes("riscv")) return "riscv64";
  if (t.includes("ppc")) return "ppc64le";
  return null;
}

function probeRenderer(): string | null {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      (canvas.getContext("webgl") as WebGLRenderingContext | null) ??
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    if (!gl) return null;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (!ext) return null;
    return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? "");
  } catch {
    return null;
  }
}

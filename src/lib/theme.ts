/**
 * The shadow root deliberately inherits nothing, which also means it inherits
 * none of GitHub's theming. Primer's custom properties are read off the host
 * page and re-published on the shadow host, where they cascade inwards - so
 * the button follows light, dark, dimmed, high-contrast and system sync for
 * free, without us reimplementing six themes.
 */

type VarMap = Record<string, string[]>;

const MAP: VarMap = {
  "--background": ["--bgColor-default", "--color-canvas-default"],
  "--foreground": ["--fgColor-default", "--color-fg-default"],
  "--card": ["--bgColor-muted", "--color-canvas-subtle"],
  "--card-foreground": ["--fgColor-default", "--color-fg-default"],
  "--popover": [
    "--overlay-bgColor",
    "--bgColor-default",
    "--color-canvas-overlay",
  ],
  "--popover-foreground": ["--fgColor-default", "--color-fg-default"],
  "--muted": ["--bgColor-muted", "--color-canvas-subtle"],
  "--muted-foreground": ["--fgColor-muted", "--color-fg-muted"],
  "--border": ["--borderColor-default", "--color-border-default"],
  "--input": ["--borderColor-default", "--color-border-default"],
  "--primary": ["--button-primary-bgColor-rest", "--color-btn-primary-bg"],
  "--primary-foreground": [
    "--button-primary-fgColor-rest",
    "--color-btn-primary-text",
  ],
  "--accent": ["--bgColor-accent-muted", "--color-accent-subtle"],
  "--accent-foreground": ["--fgColor-accent", "--color-accent-fg"],
  "--ring": ["--focus-outlineColor", "--color-accent-emphasis"],
  "--destructive": ["--fgColor-danger", "--color-danger-fg"],
};

function readVar(style: CSSStyleDeclaration, names: string[]): string | null {
  for (const name of names) {
    const value = style.getPropertyValue(name).trim();
    if (value) return value;
  }
  return null;
}

export function applyGitHubTheme(host: HTMLElement) {
  const root = getComputedStyle(document.documentElement);
  const body = getComputedStyle(document.body);

  for (const [target, sources] of Object.entries(MAP)) {
    const value = readVar(root, sources) ?? readVar(body, sources);
    if (value) host.style.setProperty(target, value);
  }

  const fontFamily = body.fontFamily || root.fontFamily;
  if (fontFamily) host.style.setProperty("--gg-font", fontFamily);

  const dark =
    document.documentElement.dataset.colorMode === "dark" ||
    (document.documentElement.dataset.colorMode === "auto" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  host.style.colorScheme = dark ? "dark" : "light";
  host.dataset.ggTheme = dark ? "dark" : "light";
}

/** Re-sync on GitHub's own theme toggle and on OS-level scheme changes. */
export function watchGitHubTheme(host: HTMLElement): () => void {
  applyGitHubTheme(host);

  const observer = new MutationObserver(() => applyGitHubTheme(host));
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [
      "data-color-mode",
      "data-light-theme",
      "data-dark-theme",
      "class",
    ],
  });

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onMedia = () => applyGitHubTheme(host);
  media.addEventListener("change", onMedia);

  return () => {
    observer.disconnect();
    media.removeEventListener("change", onMedia);
  };
}

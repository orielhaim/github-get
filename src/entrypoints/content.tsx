import ReactDOM from "react-dom/client";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import type { ShadowRootContentScriptUi } from "wxt/utils/content-script-ui/shadow-root";
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root";
import { defineContentScript } from "wxt/utils/define-content-script";

import "@/assets/globals.css";
import { App } from "@/components/github-get/app";
import { PortalTargetContext } from "@/components/ui/portal-target";
import { parseRepoFromUrl, type RepoRef } from "@/lib/github/repo-context";
import { watchGitHubTheme } from "@/lib/theme";

const UI_NAME = "github-get";

/** Language-independent, and stable across GitHub's redesigns. */
const ANCHOR_SELECTORS = [
  "#repository-details-container",
  '[data-testid="repository-details-container"]',
  ".pagehead-actions",
];

/** Narrower observer target than <body>, which mutates constantly on GitHub. */
const OBSERVE_SELECTORS = [
  "#repository-container-header",
  "#repo-title-component",
];

type Mounted = {
  root: ReactDOM.Root;
  portalTarget: HTMLElement | null;
  disposeTheme: () => void;
  item: HTMLElement | null;
};

export default defineContentScript({
  matches: ["https://github.com/*"],
  runAt: "document_idle",
  cssInjectionMode: "ui",

  async main(ctx) {
    let ui: ShadowRootContentScriptUi<Mounted> | null = null;
    let mountedKey: string | null = null;
    let observer: MutationObserver | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    let queued = false;

    const findAnchor = (): HTMLElement | null => {
      for (const selector of ANCHOR_SELECTORS) {
        const node = document.querySelector<HTMLElement>(selector);
        if (!node) continue;
        const list = node.matches("ul") ? node : node.querySelector("ul");
        return list ?? node;
      }
      return null;
    };

    // Disconnecting drops every record queued so far, including the ones our
    // own insertion just produced. This is what makes the loop impossible:
    // nothing we do to the DOM can ever be reported back to us.
    const pause = () => observer?.disconnect();

    const resume = () => {
      if (!observer || !ctx.isValid) return;
      const target =
        OBSERVE_SELECTORS.map((s) => document.querySelector(s)).find(Boolean) ??
        document.body;
      observer.observe(target, { childList: true, subtree: true });
    };

    const teardown = () => {
      ui?.remove();
      ui = null;
      mountedKey = null;
    };

    const render = (
      root: ReactDOM.Root,
      portalTarget: HTMLElement | null,
      repo: RepoRef,
    ) => {
      root.render(
        <PortalTargetContext.Provider value={portalTarget}>
          {/* Keyed so switching repositories resets state instead of leaking it. */}
          <App key={repo.key} repo={repo} />
        </PortalTargetContext.Provider>,
      );
    };

    const sync = async () => {
      if (!ctx.isValid) return;
      if (running) {
        queued = true;
        return;
      }
      running = true;
      pause();

      try {
        const repo = parseRepoFromUrl(location.href);
        if (!repo) {
          teardown();
          return;
        }

        const anchor = findAnchor();
        if (!anchor) {
          // Stale button from the previous repo must not linger while the new
          // header is still rendering.
          if (mountedKey !== null && mountedKey !== repo.key) teardown();
          return;
        }

        const host = ui?.shadowHost ?? null;
        const attached =
          host !== null && host.isConnected && anchor.contains(host);

        if (ui && host) {
          if (!attached) placeInActionList(host, anchor);
          if (mountedKey !== repo.key) {
            const mounted = ui.mounted;
            if (mounted) {
              render(mounted.root, mounted.portalTarget, repo);
              mountedKey = repo.key;
            } else {
              teardown();
            }
          }
          if (ui) return;
        }

        // createShadowRootUi is async (it fetches the entrypoint CSS), so this
        // is the only path that should ever run more than once per page load.
        ui = await buildUi(ctx, repo, findAnchor, render);
        ui.mount();
        mountedKey = repo.key;
      } finally {
        running = false;
        resume();
        if (queued) {
          queued = false;
          void sync();
        }
      }
    };

    const schedule = () => {
      if (debounce) clearTimeout(debounce);
      debounce = ctx.setTimeout(() => void sync(), 120);
    };

    observer = new MutationObserver(schedule);
    ctx.onInvalidated(() => {
      observer?.disconnect();
      observer = null;
    });

    ctx.addEventListener(window, "wxt:locationchange", () => void sync());
    ctx.addEventListener(document, "turbo:load", schedule);
    ctx.addEventListener(document, "pjax:end", schedule);
    ctx.addEventListener(document, "soft-nav:end", schedule);

    await sync();
  },
});

function buildUi(
  ctx: ContentScriptContext,
  repo: RepoRef,
  findAnchor: () => HTMLElement | null,
  render: (
    root: ReactDOM.Root,
    portalTarget: HTMLElement | null,
    repo: RepoRef,
  ) => void,
) {
  return createShadowRootUi<Mounted>(ctx, {
    name: UI_NAME,
    position: "inline",
    anchor: () => findAnchor(),
    // "last" rather than "first": React reconciles trailing foreign nodes
    // without complaint, but a prepended one sits exactly where it inserts
    // its own children and eventually throws.
    append: "last",
    isolateEvents: ["keydown", "keyup", "keypress"],

    onMount(container, shadow, shadowHost) {
      const anchor = findAnchor();
      if (anchor) placeInActionList(shadowHost, anchor);

      shadowHost.style.display = "inline-flex";
      shadowHost.style.alignItems = "center";
      shadowHost.style.verticalAlign = "middle";

      const disposeTheme = watchGitHubTheme(shadowHost as HTMLElement);

      const app = document.createElement("div");
      app.style.display = "inline-flex";
      container.append(app);

      const portalTarget =
        (shadow.querySelector("body") as HTMLElement | null) ?? container;

      const root = ReactDOM.createRoot(app);
      render(root, portalTarget, repo);

      const hostItem = shadowHost.closest("li");

      return { root, portalTarget, disposeTheme, item: hostItem };
    },

    onRemove(mounted) {
      mounted?.item?.remove();
      mounted?.disposeTheme();
      // Deferred: unmounting synchronously from inside a React commit or a
      // MutationObserver callback logs a warning and can drop effect cleanup.
      const root = mounted?.root;
      if (root) queueMicrotask(() => root.unmount());
    },
  });
}

const ITEM_ATTR = "data-ghget-item";

function placeInActionList(host: HTMLElement, anchor: HTMLElement) {
  if (anchor.tagName !== "UL") {
    if (host.parentElement !== anchor) anchor.append(host);
    host.style.marginLeft = "8px";
    return;
  }

  host.style.marginLeft = "";
  let item = host.closest(`li[${ITEM_ATTR}]`);
  if (!item || item.parentElement !== anchor) {
    item = document.createElement("li");
    item.setAttribute(ITEM_ATTR, "");
    const sibling = anchor.querySelector(`:scope > li:not([${ITEM_ATTR}])`);
    if (sibling) item.className = sibling.className;
    item.style.display = "flex";
    item.style.alignItems = "center";
    item.style.listStyle = "none";
  }
  if (item !== anchor.firstElementChild)
    anchor.insertBefore(item, anchor.firstChild);
  if (host.parentElement !== item) item.append(host);
}

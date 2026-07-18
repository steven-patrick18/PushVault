/**
 * PushVault snippet — vanilla TS, compiled to a single ES2017 IIFE.
 * Behavior spec §10.2:
 *  - never blocks page content (banner only, top or bottom, dismissible)
 *  - browser permission prompt fires ONLY after the soft prompt is accepted
 *  - respects prior choice; never renders when permission is denied/unsupported
 */

declare const __APP_BASE__: string;

interface PromptConfig {
  trigger?: { type: "delay" | "scroll" | "exit_intent" | "immediate"; seconds?: number; percent?: number };
  pages?: { include?: string[]; exclude?: string[] };
  // pop-under: after `delaySeconds`, the NEXT click opens `url` in a background
  // tab (browsers block auto-popups, so it must ride a user click), at most once
  // per `everyHours`.
  popunder?: { enabled?: boolean; url?: string; delaySeconds?: number; everyHours?: number };
  text?: { headline?: string; sub?: string; yes?: string; no?: string; callNumber?: string };
  style?: {
    position?: "top" | "bottom" | "float" | "modal" | "toast";
    /** float mode anchor, in viewport % (banner center) */
    x?: number;
    y?: number;
    width?: number; // max width px
    radius?: number;
    theme?: "light" | "dark";
    bg?: string;
    text_color?: string;
    shadow?: "none" | "soft" | "strong";
    scale?: number; // fine size, ~0.7–1.5
    accent?: string;
    logo?: string | null;
    size?: "compact" | "normal" | "large"; // legacy presets → scale
    icon?: string; // emoji shown before the headline ("" = none)
    closeButton?: boolean; // show the ✕ dismiss (default true)
    showNo?: boolean; // show the "No" button (default true)
    buttonStyle?: "fill" | "outline"; // Yes-button look
    animation?: "none" | "fade" | "slide" | "pop"; // entrance
    autoClose?: number; // auto-dismiss after N seconds (0 = never)
    toastCorner?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
    layout?: "row" | "stack"; // content flow: inline row vs stacked column
    align?: "start" | "center" | "end"; // content/text alignment
    logoPos?: "start" | "end" | "top" | "bottom"; // inline before/after, or full-width header/footer banner
    minHeight?: number; // fixed min height px (0 = auto)
    yesAction?: "subscribe" | "call"; // what the primary button does
    buttonSize?: "sm" | "md" | "lg"; // button size
    buttonFull?: boolean; // full-width stacked buttons
    buttonOrder?: "yes-first" | "no-first"; // which button comes first
  };
  reask?: {
    enabled?: boolean;
    cooldown_days?: number; // legacy
    cooldown_value?: number;
    cooldown_unit?: "seconds" | "minutes" | "hours" | "days";
    /** re-show on the SAME page after the cooldown, not only on the next visit */
    same_page?: boolean;
  };
}

interface RemoteConfig {
  prompt_config: PromptConfig;
  icon_url: string | null;
  vapid_public_key: string;
}

(function () {
  const API = __APP_BASE__ + "/api/v1/public";
  const script =
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>("script[data-property-key]");
  const propertyKey = script?.dataset.propertyKey;
  if (!propertyKey) return;

  const LS_CHOICE = "pv_choice_" + propertyKey;
  const LS_CONFIG = "pv_cfg_" + propertyKey;
  // fetched at most once per page load, then reused for this view
  let configPromise: Promise<RemoteConfig | null> | null = null;

  // ---- one-click app install (Windows/Mac/Android via Chrome/Edge PWA) ----
  // Capture the browser's install prompt so we can fire it on OUR button.
  // Must be registered before the event fires, hence top-level.
  let deferredInstall: any = null;
  window.addEventListener("beforeinstallprompt", (e: any) => {
    e.preventDefault(); // suppress Chrome's mini-infobar; we show our own UI
    deferredInstall = e;
  });

  // The page must have a web-app manifest to be installable. If the site
  // doesn't ship one, inject a minimal manifest (site name + our bell icon)
  // as a data: URL — enough for Chrome/Edge install criteria on HTTPS.
  function ensureManifest() {
    try {
      if (document.querySelector('link[rel="manifest"]')) return;
      const name = (document.title || location.hostname).slice(0, 45) || "Web App";
      const manifest = {
        name,
        short_name: name.slice(0, 12),
        start_url: location.origin + "/",
        scope: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#7C3AED",
        icons: [
          { src: __APP_BASE__ + "/cdn/pv-icon-192.png", sizes: "192x192", type: "image/png" },
          { src: __APP_BASE__ + "/cdn/pv-icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      };
      const link = document.createElement("link");
      link.rel = "manifest";
      link.href = "data:application/manifest+json," + encodeURIComponent(JSON.stringify(manifest));
      document.head.appendChild(link);
    } catch {
      /* ignore */
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureManifest);
  } else {
    ensureManifest();
  }

  // page discovery works everywhere, even where push is unsupported
  beaconPageview();

  // iOS/iPadOS Safari only allows web push from a Home-Screen (installed) app —
  // regular Safari has no PushManager at all. We can't subscribe there, but we
  // CAN show an "Add to Home Screen" guide so those visitors aren't a dead end.
  const _ua = navigator.userAgent || "";
  const isIOS =
    /iPad|iPhone|iPod/.test(_ua) ||
    (navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1);
  const standalone =
    (navigator as any).standalone === true ||
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  const iosNeedsInstall = isIOS && !standalone;

  // 6. unsupported browser or already-denied permission: never render — EXCEPT
  // iOS-needs-install, which still shows the guide banner.
  if (!iosNeedsInstall) {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
    if (Notification.permission === "denied") return;
  }

  function getChoice(): { choice: string; ts: number } | null {
    try {
      const raw = localStorage.getItem(LS_CHOICE);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setChoice(choice: "yes" | "no" | "subscribed") {
    try {
      localStorage.setItem(LS_CHOICE, JSON.stringify({ choice, ts: Date.now() }));
    } catch {
      /* ignore */
    }
  }

  /**
   * Load the prompt design. Always fetches the latest from the server (once
   * per page load, memoized) so design changes saved in the dashboard take
   * effect on the very next page load — no 1-hour cache lag. The stored copy
   * is only a fallback for when the network/API is unreachable, so the banner
   * still works offline.
   */
  function fetchConfig(): Promise<RemoteConfig | null> {
    if (configPromise) return configPromise;
    configPromise = (async () => {
      try {
        const res = await fetch(API + "/prompt-config?property_key=" + encodeURIComponent(propertyKey!));
        if (res.ok) {
          const data = (await res.json()) as RemoteConfig;
          try {
            localStorage.setItem(LS_CONFIG, JSON.stringify({ ts: Date.now(), data }));
          } catch {
            /* ignore */
          }
          return data;
        }
      } catch {
        /* network/API down → fall back to last-known config below */
      }
      try {
        const cached = localStorage.getItem(LS_CONFIG);
        if (cached) return JSON.parse(cached).data as RemoteConfig;
      } catch {
        /* ignore */
      }
      return null;
    })();
    return configPromise;
  }

  function pageMatches(pages?: PromptConfig["pages"]): boolean {
    const path = location.pathname;
    const toRegex = (glob: string) =>
      new RegExp("^" + glob.split("*").map(escapeRe).join(".*") + "$");
    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const include = pages?.include?.length ? pages.include : ["*"];
    const exclude = pages?.exclude ?? [];
    if (exclude.some((g) => toRegex(g).test(path))) return false;
    return include.some((g) => g === "*" || toRegex(g).test(path));
  }

  function urlBase64ToUint8Array(base64: string): Uint8Array {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(b64);
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  function parseUtm(): Record<string, string> {
    const params = new URLSearchParams(location.search);
    const utm: Record<string, string> = {};
    for (const k of ["source", "medium", "campaign", "content", "term"]) {
      const v = params.get("utm_" + k);
      if (v) utm[k] = v;
    }
    return utm;
  }

  async function doSubscribe(vapidPublicKey: string): Promise<boolean> {
    // 4. permission prompt only fires here — after explicit "Yes"
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setChoice("no");
      return false;
    }
    try {
      // updateViaCache none + explicit update(): subscribers pick up new
      // worker versions on their next visit instead of waiting out HTTP cache
      const reg = await navigator.serviceWorker.register("/pv-sw.js", { updateViaCache: "none" });
      reg.update().catch(() => undefined);
      // never wait forever on activation — some browsers/edge cases stall here,
      // which would hang the subscribe button. Time out after 15s.
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, rej) => setTimeout(() => rej(new Error("sw-timeout")), 15000)),
      ]);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      });
      const json = sub.toJSON();
      const res = await fetch(API + "/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_key: propertyKey,
          subscription: { endpoint: json.endpoint, keys: json.keys },
          utm: parseUtm(),
          landing_url: location.href,
          referrer: document.referrer || undefined,
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          lang: navigator.language,
        }),
      });
      if (res.ok) {
        setChoice("subscribed");
        // they just opted in — perfect moment to offer the 1-click app install
        setTimeout(showInstallToast, 1200);
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  const UNIT_MS: Record<string, number> = { seconds: 1000, minutes: 60_000, hours: 3600_000, days: 86400_000 };
  function reaskCooldownMs(reask: any): number {
    return reask?.cooldown_value != null
      ? reask.cooldown_value * (UNIT_MS[reask.cooldown_unit ?? "days"] ?? 86400_000)
      : (reask?.cooldown_days ?? 7) * 86400_000;
  }

  // After a "No", if same-page re-ask is enabled, re-show the prompt on THIS
  // page once the cooldown passes (no reload needed). Only for short cooldowns —
  // a days-long same-page timer is pointless and would overflow setTimeout, so
  // those fall back to the next-visit re-ask handled in init().
  function scheduleSamePageReask(cfg: RemoteConfig) {
    const reask = cfg.prompt_config?.reask;
    if (!reask?.enabled || !reask.same_page) return;
    const ms = reaskCooldownMs(reask);
    if (ms <= 0 || ms > 6 * 3600_000) return; // cap at 6h
    setTimeout(() => {
      const c = getChoice();
      if (!c || c.choice === "no") renderBanner(cfg);
    }, ms);
  }

  // Centered modal card (style.position === "modal") — a full-screen dimmed
  // overlay with a card in the middle, matching the hosted opt-in page look.
  function renderModal(cfg: RemoteConfig) {
    const pc = cfg.prompt_config ?? {};
    const text = pc.text ?? {};
    const style = pc.style ?? {};
    const accent = style.accent || "#7C3AED";
    const dark = style.theme === "dark";
    const bg = style.bg || (dark ? "#16161e" : "#ffffff");
    const textColor = style.text_color || (dark ? "#f0f0f5" : "#16161e");
    const subColor = dark ? "#9a9aad" : "#6a6a78";
    const radius = style.radius ?? 20;
    const icon = style.icon === undefined ? "🔔" : style.icon;
    const showClose = style.closeButton !== false;
    const showNo = style.showNo !== false;
    const outline = style.buttonStyle === "outline";
    const bf = style.buttonSize === "sm" ? 0.82 : style.buttonSize === "lg" ? 1.24 : 1;

    const host = document.createElement("div");
    host.id = "pushvault-prompt";
    host.style.cssText =
      "position:fixed;inset:0;z-index:2147483000;background:rgba(6,6,12,.62);" +
      "display:flex;align-items:center;justify-content:center;padding:20px;pointer-events:auto;";
    const shadow = host.attachShadow({ mode: "closed" });
    const wrap = document.createElement("div");
    wrap.innerHTML =
      '<div class="pv-card" role="dialog" aria-modal="true" aria-label="Notification opt-in">' +
      (showClose ? '<button class="pv-x" aria-label="Close">&#10005;</button>' : "") +
      (style.logo
        ? '<img class="pv-logo" src="' + style.logo + '" alt="">'
        : icon ? '<div class="pv-bell">' + icon + "</div>" : "") +
      '<div class="pv-head"></div>' +
      '<div class="pv-sub"></div>' +
      '<button class="pv-yes"></button>' +
      (showNo ? '<button class="pv-no"></button>' : "") +
      "</div>";
    const css = document.createElement("style");
    css.textContent =
      ".pv-card{position:relative;pointer-events:auto;max-width:400px;width:100%;text-align:center;" +
      "background:" + bg + ";color:" + textColor + ";border-radius:" + radius + "px;padding:34px 30px 28px;" +
      "box-shadow:0 24px 70px rgba(0,0,0,.45);font-family:system-ui,-apple-system,sans-serif;" +
      "animation:pvin .22s ease-out}" +
      "@keyframes pvin{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}" +
      ".pv-bell{font-size:52px;line-height:1;margin-bottom:12px}" +
      ".pv-logo{width:60px;height:60px;border-radius:14px;object-fit:cover;display:block;margin:0 auto 14px}" +
      ".pv-head{font-size:21px;font-weight:700;line-height:1.3;margin-bottom:8px}" +
      ".pv-sub{font-size:14px;color:" + subColor + ";line-height:1.5;margin-bottom:22px}" +
      (outline
        ? ".pv-yes{width:100%;background:transparent;color:" + accent + ";border:2px solid " + accent + ";border-radius:12px;padding:" + Math.round(14 * bf) + "px;font-size:" + Math.round(16 * bf) + "px;font-weight:700;cursor:pointer}"
        : ".pv-yes{width:100%;background:" + accent + ";color:#fff;border:none;border-radius:12px;padding:" + Math.round(15 * bf) + "px;font-size:" + Math.round(16 * bf) + "px;font-weight:700;cursor:pointer}") +
      ".pv-no{width:100%;background:none;border:none;color:" + subColor + ";font-size:13px;" +
      "padding:12px 0 0;cursor:pointer}" +
      ".pv-x{position:absolute;top:12px;right:14px;background:none;border:none;color:" + subColor +
      ";font-size:15px;cursor:pointer;line-height:1}";
    shadow.appendChild(css);
    shadow.appendChild(wrap);

    (shadow.querySelector(".pv-head") as HTMLElement).textContent =
      text.headline || "Get notified about updates?";
    (shadow.querySelector(".pv-sub") as HTMLElement).textContent =
      text.sub || "Allow notifications to get our latest offers and updates.";
    const yesBtn = shadow.querySelector(".pv-yes") as HTMLButtonElement;
    const noBtn = shadow.querySelector(".pv-no") as HTMLButtonElement | null;
    yesBtn.textContent = text.yes || "Yes, notify me";
    if (noBtn) noBtn.textContent = text.no || "No thanks";

    const remove = () => host.remove();
    const dismiss = () => { setChoice("no"); remove(); scheduleSamePageReask(cfg); };
    const callMode = style.yesAction === "call" && !!(text.callNumber || "").replace(/[^\d+]/g, "");
    if (callMode) yesBtn.textContent = text.yes || "📞 Call now";
    else if (iosNeedsInstall) yesBtn.textContent = "📲 " + (text.yes || "Enable");
    yesBtn.addEventListener("click", async () => {
      if (callMode) {
        const num = (text.callNumber || "").replace(/[^\d+]/g, "");
        try { location.href = "tel:" + num; } catch { /* ignore */ }
        setChoice("no"); // re-ask settings govern when the call popup returns
        remove();
        scheduleSamePageReask(cfg);
        return;
      }
      if (iosNeedsInstall) {
        showIosSteps(shadow.querySelector(".pv-card") as HTMLElement, textColor, accent);
        return;
      }
      yesBtn.disabled = true;
      yesBtn.textContent = "…";
      remove();
      await doSubscribe(cfg.vapid_public_key);
    });
    if (noBtn) noBtn.addEventListener("click", dismiss);
    const xBtn = shadow.querySelector(".pv-x") as HTMLButtonElement | null;
    if (xBtn) xBtn.addEventListener("click", dismiss);
    const autoClose = Number(style.autoClose) || 0;
    if (autoClose > 0) setTimeout(() => { if (document.getElementById("pushvault-prompt")) dismiss(); }, autoClose * 1000);
    host.addEventListener("click", (e) => { if (e.target === host) dismiss(); });

    document.documentElement.appendChild(host);
  }

  // iOS Safari can't subscribe from the browser; show a full-screen guided
  // overlay pointing at the Share button (bottom bar on iPhone, top-right on
  // iPad) with a bouncing arrow. One tap on our prompt → this guide → the
  // visitor taps Share → Add to Home Screen. As close to 1-click as iOS allows.
  function showIosSteps(container: HTMLElement | null, _textColor?: string, accent = "#7C3AED") {
    // remove the prompt that triggered us
    if (container) {
      const root = container.getRootNode() as ShadowRoot;
      (root?.host as HTMLElement)?.remove();
    }
    if (document.getElementById("pushvault-ios-guide")) return;
    const isIpad =
      /iPad/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1);
    const host = document.createElement("div");
    host.id = "pushvault-ios-guide";
    host.style.cssText = "position:fixed;inset:0;z-index:2147483001;";
    const shadow = host.attachShadow({ mode: "closed" });
    const shareSvg =
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0a84ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-4px"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><rect x="4" y="11" width="16" height="10" rx="2"/></svg>';
    const wrap = document.createElement("div");
    wrap.innerHTML =
      '<div class="pv-dim"></div>' +
      '<div class="pv-sheet">' +
      '<div class="pv-t">📲 Get alerts on your iPhone</div>' +
      '<div class="pv-step"><span class="pv-n">1</span> Tap the <b>Share</b> button ' + shareSvg + (isIpad ? " (top right)" : " (bottom bar)") + "</div>" +
      '<div class="pv-step"><span class="pv-n">2</span> Tap <b>Add to Home Screen</b> <span class="pv-plus">&#10133;</span></div>' +
      '<div class="pv-step"><span class="pv-n">3</span> Open it from your Home Screen &amp; tap <b>Enable</b></div>' +
      '<button class="pv-ok">Got it</button>' +
      "</div>" +
      '<div class="pv-arrow">&#8595;</div>';
    const css = document.createElement("style");
    css.textContent =
      ".pv-dim{position:absolute;inset:0;background:rgba(4,4,10,.72)}" +
      ".pv-sheet{position:absolute;left:12px;right:12px;" + (isIpad ? "top:70px;" : "bottom:110px;") +
      "background:#fff;color:#111;border-radius:18px;padding:22px 20px;max-width:430px;margin:0 auto;" +
      "font:15px/1.55 system-ui,-apple-system,sans-serif;box-shadow:0 18px 60px rgba(0,0,0,.4);" +
      "animation:pvup .25s ease-out}" +
      "@keyframes pvup{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}" +
      ".pv-t{font-size:18px;font-weight:800;margin-bottom:12px}" +
      ".pv-step{display:flex;align-items:center;gap:10px;margin:9px 0}" +
      ".pv-n{flex-shrink:0;width:22px;height:22px;border-radius:50%;background:" + accent + ";color:#fff;" +
      "font-size:12px;font-weight:700;display:inline-flex;align-items:center;justify-content:center}" +
      ".pv-plus{color:" + accent + "}" +
      ".pv-ok{margin-top:14px;width:100%;background:" + accent + ";color:#fff;border:none;border-radius:12px;" +
      "padding:13px;font-size:15px;font-weight:700;cursor:pointer}" +
      ".pv-arrow{position:absolute;" +
      (isIpad ? "top:8px;right:26px;" : "bottom:34px;left:50%;margin-left:-14px;") +
      "font-size:42px;color:#fff;text-shadow:0 2px 10px rgba(0,0,0,.6);" +
      "animation:pvbounce 1s ease-in-out infinite" + (isIpad ? ";transform:rotate(180deg)" : "") + "}" +
      "@keyframes pvbounce{0%,100%{transform:translateY(0)" + (isIpad ? " rotate(180deg)" : "") + "}50%{transform:translateY(" + (isIpad ? "-" : "") + "10px)" + (isIpad ? " rotate(180deg)" : "") + "}}";
    shadow.appendChild(css);
    shadow.appendChild(wrap);
    const close = () => host.remove();
    (shadow.querySelector(".pv-ok") as HTMLButtonElement).addEventListener("click", close);
    (shadow.querySelector(".pv-dim") as HTMLElement).addEventListener("click", close);
    document.documentElement.appendChild(host);
  }

  // After a successful subscribe (or on demand), offer the real 1-click app
  // install using the captured beforeinstallprompt.
  function showInstallToast() {
    if (!deferredInstall || document.getElementById("pushvault-install")) return;
    const host = document.createElement("div");
    host.id = "pushvault-install";
    host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483001;";
    const shadow = host.attachShadow({ mode: "closed" });
    const wrap = document.createElement("div");
    wrap.innerHTML =
      '<div class="pv-toast">📲 <span>Install our app for faster access</span>' +
      '<button class="pv-go">Install</button><button class="pv-x">&#10005;</button></div>';
    const css = document.createElement("style");
    css.textContent =
      ".pv-toast{display:flex;align-items:center;gap:10px;background:#1c1c26;color:#f0f0f5;" +
      "border-radius:14px;padding:12px 14px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 10px 34px rgba(0,0,0,.35);" +
      "animation:pvin .25s ease-out}@keyframes pvin{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}" +
      ".pv-go{background:#7C3AED;color:#fff;border:none;border-radius:9px;padding:8px 14px;font-weight:700;cursor:pointer}" +
      ".pv-x{background:none;border:none;color:#8a8a98;cursor:pointer;font-size:12px;padding:4px}";
    shadow.appendChild(css);
    shadow.appendChild(wrap);
    (shadow.querySelector(".pv-go") as HTMLButtonElement).addEventListener("click", async () => {
      host.remove();
      try {
        deferredInstall.prompt();
        await deferredInstall.userChoice;
      } catch { /* ignore */ }
      deferredInstall = null;
    });
    (shadow.querySelector(".pv-x") as HTMLButtonElement).addEventListener("click", () => host.remove());
    document.documentElement.appendChild(host);
    setTimeout(() => host.remove(), 30_000);
  }

  function renderBanner(cfg: RemoteConfig) {
    const pc = cfg.prompt_config ?? {};
    if (pc.style?.position === "modal") return renderModal(cfg);
    const text = pc.text ?? {};
    const style = pc.style ?? {};
    const accent = style.accent || "#7C3AED";
    const isToast = style.position === "toast";
    const mode = isToast ? "toast" : style.position === "bottom" ? "bottom" : style.position === "float" ? "float" : "top";
    const legacyScale = { compact: 0.85, normal: 1, large: 1.15 } as const;
    const scale = Math.min(1.6, Math.max(0.6, style.scale ?? legacyScale[style.size ?? "normal"] ?? 1));
    const dark = style.theme === "dark";
    const bg = style.bg || (dark ? "#20212b" : "#ffffff");
    const textColor = style.text_color || (dark ? "#f0f0f5" : "#1a1a2a");
    const radius = style.radius ?? 12;
    const shadowCss =
      style.shadow === "none" ? "none"
        : style.shadow === "strong" ? "0 12px 44px rgba(0,0,0,.38)"
          : "0 4px 24px rgba(0,0,0,.18)";
    const maxWidth = Math.min(Math.max(style.width ?? 680, 220), 900);
    const px = (n: number) => Math.round(n * scale) + "px";
    // new design/behaviour options (all optional, back-compatible defaults)
    const icon = style.icon === undefined ? "🔔" : style.icon;
    const showClose = style.closeButton !== false;
    const showNo = style.showNo !== false;
    const outline = style.buttonStyle === "outline";
    const anim = style.animation ?? "slide";
    const corner = style.toastCorner || "bottom-right";
    const sub = text.sub || "";
    const stack = style.layout === "stack";
    const alignMap: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end" };
    const alignFlex = alignMap[style.align ?? "start"] ?? "flex-start";
    const alignText = style.align === "center" ? "center" : style.align === "end" ? "right" : "left";
    const logoEnd = style.logoPos === "end";
    const minH = Math.max(0, Number(style.minHeight) || 0);
    // logo used as a full-width header/footer banner strip
    const logoBanner = !!style.logo && (style.logoPos === "top" || style.logoPos === "bottom");
    const bannerTop = style.logoPos === "top";
    const col = stack || logoBanner; // column layout when stacked or banner-logo
    const bandBg = dark ? "#2a2b36" : "#f2f2f7";
    const padV = Math.round(12 * scale);
    const padH = Math.round(16 * scale);
    const bf = style.buttonSize === "sm" ? 0.82 : style.buttonSize === "lg" ? 1.24 : 1; // button size factor
    const btnFull = style.buttonFull === true;
    const noFirst = style.buttonOrder === "no-first";

    const host = document.createElement("div");
    host.id = "pushvault-prompt";
    host.style.cssText =
      mode === "float" || mode === "toast"
        ? "position:fixed;inset:0;z-index:2147483000;pointer-events:none;"
        : "position:fixed;" + mode + ":0;left:0;right:0;z-index:2147483000;pointer-events:none;";
    const shadow = host.attachShadow({ mode: "closed" });

    const wrap = document.createElement("div");
    if (mode === "float") {
      const fx = Math.min(95, Math.max(5, style.x ?? 50));
      const fy = Math.min(95, Math.max(5, style.y ?? 50));
      wrap.style.cssText =
        "position:absolute;left:" + fx + "%;top:" + fy + "%;transform:translate(-50%,-50%);" +
        "width:min(" + maxWidth + "px,94vw);pointer-events:none;";
    } else if (mode === "toast") {
      const vy = corner.indexOf("top") === 0 ? "top:18px;" : "bottom:18px;";
      const vx = corner.indexOf("left") >= 0 ? "left:18px;" : "right:18px;";
      wrap.style.cssText = "position:absolute;" + vy + vx + "width:min(" + Math.min(maxWidth, 380) + "px,92vw);pointer-events:none;";
    }
    const bannerImg = logoBanner ? '<img class="pv-band" src="' + style.logo + '" alt="">' : "";
    const inlineMark = logoBanner
      ? ""
      : style.logo
        ? '<img class="pv-logo" src="' + style.logo + '" alt="">'
        : icon
          ? '<span class="pv-ic">' + icon + "</span>"
          : "";
    wrap.innerHTML =
      '<div class="pv-bar" role="dialog" aria-label="Notification opt-in">' +
      (logoBanner && bannerTop ? bannerImg : "") +
      inlineMark +
      '<span class="pv-txt"><span class="pv-head"></span>' + (sub ? '<span class="pv-sub"></span>' : "") + "</span>" +
      '<span class="pv-actions">' +
      '<button class="pv-yes"></button>' +
      (showNo ? '<button class="pv-no"></button>' : "") +
      (showClose ? '<button class="pv-x" aria-label="Dismiss">&#10005;</button>' : "") +
      "</span>" +
      (logoBanner && !bannerTop ? bannerImg : "") +
      "</div>";
    const noBg = dark ? "#34353f" : "#f5f5f7";
    const noColor = dark ? "#d5d5dd" : "#333";
    const noBorder = dark ? "#4a4b55" : "#ddd";
    // entrance animation
    const animCss =
      anim === "none" ? ""
        : anim === "fade" ? "@keyframes pventer{from{opacity:0}to{opacity:1}}.pv-bar{animation:pventer .25s ease-out}"
          : anim === "pop" ? "@keyframes pventer{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:none}}.pv-bar{animation:pventer .22s cubic-bezier(.2,1.3,.5,1)}"
            : "@keyframes pventer{from{opacity:0;transform:translateY(" + (mode === "top" ? "-14px" : "14px") + ")}to{opacity:1;transform:none}}.pv-bar{animation:pventer .25s ease-out}";
    const css = document.createElement("style");
    css.textContent =
      ".pv-bar{pointer-events:auto;display:flex;overflow:hidden;" +
      (col
        ? "flex-direction:column;align-items:" + alignFlex + ";text-align:" + alignText + ";"
        : "align-items:center;flex-wrap:wrap;") +
      "gap:" + px(12) + ";" +
      (minH > 0 ? "min-height:" + minH + "px;" : "") +
      (mode === "float" || mode === "toast" ? "margin:0;" : "margin:8px auto;max-width:" + maxWidth + "px;") +
      "padding:" + padV + "px " + padH + "px;border-radius:" + radius + "px;background:" + bg + ";color:" + textColor + ";" +
      "box-shadow:" + shadowCss + ";font:" + px(14) + "/1.4 system-ui,sans-serif;box-sizing:border-box;}" +
      (logoEnd ? ".pv-ic,.pv-logo{order:9}" : "") +
      // full-width header/footer banner: bleed to the edges, neutral band
      ".pv-band{align-self:stretch;width:calc(100% + " + 2 * padH + "px);margin:" +
      (bannerTop ? "-" + padV + "px -" + padH + "px 0 -" + padH + "px" : "0 -" + padH + "px -" + padV + "px -" + padH + "px") +
      ";height:" + Math.round(70 * scale) + "px;object-fit:contain;background:" + bandBg + ";padding:" + px(8) + ";box-sizing:border-box;" +
      "border-radius:" + (bannerTop ? radius + "px " + radius + "px 0 0" : "0 0 " + radius + "px " + radius + "px") + "}" +
      ".pv-logo{width:" + px(28) + ";height:" + px(28) + ";border-radius:6px;object-fit:cover}" +
      ".pv-ic{font-size:" + px(22) + ";line-height:1}" +
      ".pv-txt{" + (col ? "" : "flex:1;") + "min-width:130px;display:flex;flex-direction:column;gap:2px;align-items:" + (col ? alignFlex : "flex-start") + "}" +
      ".pv-head{font-weight:600}" +
      ".pv-sub{font-size:" + px(12) + ";opacity:.72;font-weight:400}" +
      ".pv-actions{display:flex;gap:8px;" +
      (btnFull
        ? "flex-direction:column;align-items:stretch;width:100%;"
        : "align-items:center;flex-wrap:wrap;" + (col ? "width:100%;justify-content:" + alignFlex + ";" : "")) +
      "}" +
      "button{cursor:pointer;border-radius:" + Math.max(4, Math.round(radius * 0.66)) + "px;font:600 " + px(13 * bf) + " system-ui,sans-serif;padding:" + px(8 * bf) + " " + px(14 * bf) + ";border:1px solid " + noBorder + ";background:" + noBg + ";color:" + noColor + "}" +
      (btnFull ? ".pv-yes,.pv-no{width:100%;text-align:center}" : "") +
      (noFirst ? ".pv-yes{order:2}.pv-no{order:1}" : "") +
      (outline
        ? ".pv-yes{background:transparent;border:2px solid " + accent + ";color:" + accent + "}"
        : ".pv-yes{background:" + accent + ";border-color:" + accent + ";color:#fff}") +
      ".pv-x{border:none;background:none;font-size:" + px(12) + ";color:#999;padding:4px 6px}" +
      animCss;
    shadow.appendChild(css);
    shadow.appendChild(wrap);

    (shadow.querySelector(".pv-head") as HTMLElement).textContent = text.headline || "Get notified about updates?";
    if (sub) (shadow.querySelector(".pv-sub") as HTMLElement).textContent = sub;
    const yesBtn = shadow.querySelector(".pv-yes") as HTMLButtonElement;
    const noBtn = shadow.querySelector(".pv-no") as HTMLButtonElement | null;
    yesBtn.textContent = text.yes || "Yes, notify me";
    if (noBtn) noBtn.textContent = text.no || "No thanks";

    const remove = () => host.remove();
    const dismiss = () => { setChoice("no"); remove(); scheduleSamePageReask(cfg); };
    const callMode = style.yesAction === "call" && !!(text.callNumber || "").replace(/[^\d+]/g, "");
    if (callMode) yesBtn.textContent = text.yes || "📞 Call now";
    else if (iosNeedsInstall) yesBtn.textContent = "📲 " + (text.yes || "Enable");
    yesBtn.addEventListener("click", async () => {
      if (callMode) {
        // dial straight from the page — works on Android AND iOS from a click.
        // Record as a dismissal (not a permanent "subscribed"), so the popup
        // reappears per the re-ask settings when they reload / come back.
        const num = (text.callNumber || "").replace(/[^\d+]/g, "");
        try { location.href = "tel:" + num; } catch { /* ignore */ }
        setChoice("no");
        remove();
        scheduleSamePageReask(cfg);
        return;
      }
      if (iosNeedsInstall) {
        showIosSteps(shadow.querySelector(".pv-bar") as HTMLElement, textColor, accent);
        return;
      }
      yesBtn.disabled = true;
      yesBtn.textContent = "…";
      remove();
      await doSubscribe(cfg.vapid_public_key);
    });
    if (noBtn) noBtn.addEventListener("click", dismiss);
    const xBtn = shadow.querySelector(".pv-x") as HTMLButtonElement | null;
    if (xBtn) xBtn.addEventListener("click", dismiss);

    // auto-dismiss after N seconds (0/undefined = stay until the visitor acts)
    const autoClose = Number(style.autoClose) || 0;
    if (autoClose > 0) setTimeout(() => { if (document.getElementById("pushvault-prompt")) dismiss(); }, autoClose * 1000);

    document.documentElement.appendChild(host);
  }

  function arm(cfg: RemoteConfig) {
    const trigger = cfg.prompt_config?.trigger ?? { type: "delay", seconds: 12 };
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      renderBanner(cfg);
    };
    if (trigger.type === "immediate") {
      fire();
    } else if (trigger.type === "scroll") {
      const pct = trigger.percent ?? 40;
      const onScroll = () => {
        const doc = document.documentElement;
        const scrolled =
          (doc.scrollTop / Math.max(doc.scrollHeight - doc.clientHeight, 1)) * 100;
        if (scrolled >= pct) {
          removeEventListener("scroll", onScroll);
          fire();
        }
      };
      addEventListener("scroll", onScroll, { passive: true });
    } else if (trigger.type === "exit_intent") {
      const onLeave = (e: MouseEvent) => {
        if (e.clientY <= 0) {
          removeEventListener("mouseout", onLeave);
          fire();
        }
      };
      addEventListener("mouseout", onLeave);
    } else {
      setTimeout(fire, (trigger.seconds ?? 12) * 1000);
    }
  }

  // revenue attribution: notification clicks land with ?pv_sid=<send_id>;
  // remember it for 30 days so trackConversion can attribute the sale
  const LS_ATTRIB = "pv_attrib_" + propertyKey;
  try {
    const sid = new URLSearchParams(location.search).get("pv_sid");
    if (sid) localStorage.setItem(LS_ATTRIB, JSON.stringify({ sid, ts: Date.now() }));
  } catch {
    /* ignore */
  }

  function getAttribution(): string | undefined {
    try {
      const raw = localStorage.getItem(LS_ATTRIB);
      if (!raw) return undefined;
      const { sid, ts } = JSON.parse(raw);
      if (Date.now() - ts > 30 * 86400_000) return undefined;
      return sid;
    } catch {
      return undefined;
    }
  }

  function beaconPageview() {
    try {
      void fetch(API + "/event/pageview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_key: propertyKey, path: location.pathname }),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      /* ignore */
    }
  }

  async function init() {
    // hosted opt-in pages render their own button — no auto banner there
    if ((window as any).__PV_NO_PROMPT) return;
    // pageview is beaconed once at startup (line ~58) for all browsers
    const prior = getChoice();
    if (prior) {
      if (prior.choice === "subscribed" || prior.choice === "yes") return;
      // "no": re-ask only if configured, after cooldown
      const cfg0 = await fetchConfig();
      if (!cfg0) return;
      const reask = cfg0.prompt_config?.reask;
      if (!reask?.enabled) return;
      if (Date.now() - prior.ts < reaskCooldownMs(reask)) return;
      if (!pageMatches(cfg0.prompt_config?.pages)) return;
      arm(cfg0);
      return;
    }
    const cfg = await fetchConfig();
    if (!cfg) return;
    if (!pageMatches(cfg.prompt_config?.pages)) return;
    arm(cfg);
  }

  const PushVault = {
    subscribe: async () => {
      const cfg = await fetchConfig();
      return cfg ? doSubscribe(cfg.vapid_public_key) : false;
    },
    /** Revenue pixel: PushVault.trackConversion({amount: 499, order_id: "1234", currency: "INR"}) */
    trackConversion: async (opts: { amount: number; order_id?: string; currency?: string }) => {
      try {
        const res = await fetch(API + "/event/conversion", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            property_key: propertyKey,
            amount: opts.amount,
            order_id: opts.order_id,
            currency: opts.currency,
            send_id: getAttribution(),
          }),
          keepalive: true,
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    unsubscribe: async () => {
      const reg = await navigator.serviceWorker.getRegistration("/pv-sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) return false;
      await fetch(API + "/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_key: propertyKey, endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
      try {
        localStorage.removeItem(LS_CHOICE);
      } catch {
        /* ignore */
      }
      return true;
    },
    /** true when a real 1-click install is available (Chrome/Edge PWA) or an iOS guide can be shown */
    canInstall: () => Boolean(deferredInstall) || iosNeedsInstall,
    /** Fire the 1-click install prompt (Win/Mac/Android); on iOS shows the Home-Screen guide. */
    installApp: async (): Promise<boolean> => {
      if (deferredInstall) {
        try {
          deferredInstall.prompt();
          const choice = await deferredInstall.userChoice;
          deferredInstall = null;
          return choice?.outcome === "accepted";
        } catch {
          return false;
        }
      }
      if (iosNeedsInstall) {
        showIosSteps(null);
        return false;
      }
      return false;
    },
  };
  (window as any).PushVault = PushVault;

  // Pop-under: after a delay, the visitor's next click opens a URL in a
  // background tab. Runs independently of the opt-in prompt. Browsers only
  // allow window.open on a user gesture, so we ride the first click; a
  // per-`everyHours` cap in localStorage stops it nagging.
  async function initPopunder() {
    if ((window as any).__PV_NO_PROMPT) return;
    const cfg = await fetchConfig();
    const pu = cfg?.prompt_config?.popunder;
    if (!pu || !pu.enabled) return;
    const url = String(pu.url || "").trim();
    if (!/^https?:\/\//i.test(url)) return; // only http(s)
    if (!pageMatches(cfg!.prompt_config?.pages)) return;
    const key = "pv_pu_" + propertyKey;
    const everyMs = Math.max(0, pu.everyHours ?? 12) * 3600_000;
    try {
      const last = Number(localStorage.getItem(key) || 0);
      if (everyMs && Date.now() - last < everyMs) return;
    } catch {
      /* ignore */
    }
    const arm = () => {
      const onClick = () => {
        document.removeEventListener("click", onClick, true);
        try {
          const w = window.open(url, "_blank");
          if (w) { w.blur(); window.focus(); } // best-effort keep this tab in front
          localStorage.setItem(key, String(Date.now()));
        } catch {
          /* popup blocked */
        }
      };
      document.addEventListener("click", onClick, true);
    };
    const delay = Math.max(0, pu.delaySeconds ?? 0) * 1000;
    if (delay) setTimeout(arm, delay);
    else arm();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { void init(); void initPopunder(); });
  } else {
    void init();
    void initPopunder();
  }
})();

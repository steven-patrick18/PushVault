/**
 * PushVault snippet — vanilla TS, compiled to a single ES2017 IIFE.
 * Behavior spec §10.2:
 *  - never blocks page content (banner only, top or bottom, dismissible)
 *  - browser permission prompt fires ONLY after the soft prompt is accepted
 *  - respects prior choice; never renders when permission is denied/unsupported
 */

declare const __APP_BASE__: string;

interface PromptConfig {
  trigger?: { type: "delay" | "scroll" | "exit_intent"; seconds?: number; percent?: number };
  pages?: { include?: string[]; exclude?: string[] };
  text?: { headline?: string; sub?: string; yes?: string; no?: string };
  style?: {
    position?: "top" | "bottom" | "float" | "modal";
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
  };
  reask?: {
    enabled?: boolean;
    cooldown_days?: number; // legacy
    cooldown_value?: number;
    cooldown_unit?: "seconds" | "minutes" | "hours" | "days";
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

  // page discovery works everywhere, even where push is unsupported
  beaconPageview();

  // 6. unsupported browser or already-denied permission: never render
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
  if (Notification.permission === "denied") return;

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
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
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

    const host = document.createElement("div");
    host.id = "pushvault-prompt";
    host.style.cssText =
      "position:fixed;inset:0;z-index:2147483000;background:rgba(6,6,12,.62);" +
      "display:flex;align-items:center;justify-content:center;padding:20px;pointer-events:auto;";
    const shadow = host.attachShadow({ mode: "closed" });
    const wrap = document.createElement("div");
    wrap.innerHTML =
      '<div class="pv-card" role="dialog" aria-modal="true" aria-label="Notification opt-in">' +
      '<button class="pv-x" aria-label="Close">&#10005;</button>' +
      (style.logo
        ? '<img class="pv-logo" src="' + style.logo + '" alt="">'
        : '<div class="pv-bell">&#128276;</div>') +
      '<div class="pv-head"></div>' +
      '<div class="pv-sub"></div>' +
      '<button class="pv-yes"></button>' +
      '<button class="pv-no"></button>' +
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
      ".pv-yes{width:100%;background:" + accent + ";color:#fff;border:none;border-radius:12px;" +
      "padding:15px;font-size:16px;font-weight:700;cursor:pointer}" +
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
    const noBtn = shadow.querySelector(".pv-no") as HTMLButtonElement;
    yesBtn.textContent = text.yes || "Yes, notify me";
    noBtn.textContent = text.no || "No thanks";

    const remove = () => host.remove();
    yesBtn.addEventListener("click", async () => {
      yesBtn.disabled = true;
      yesBtn.textContent = "…";
      remove();
      await doSubscribe(cfg.vapid_public_key);
    });
    const dismiss = () => { setChoice("no"); remove(); };
    noBtn.addEventListener("click", dismiss);
    (shadow.querySelector(".pv-x") as HTMLButtonElement).addEventListener("click", dismiss);
    host.addEventListener("click", (e) => { if (e.target === host) dismiss(); });

    document.documentElement.appendChild(host);
  }

  function renderBanner(cfg: RemoteConfig) {
    const pc = cfg.prompt_config ?? {};
    if (pc.style?.position === "modal") return renderModal(cfg);
    const text = pc.text ?? {};
    const style = pc.style ?? {};
    const accent = style.accent || "#7C3AED";
    const mode = style.position === "bottom" ? "bottom" : style.position === "float" ? "float" : "top";
    const legacyScale = { compact: 0.85, normal: 1, large: 1.15 } as const;
    const scale = Math.min(1.6, Math.max(0.6, style.scale ?? legacyScale[style.size ?? "normal"] ?? 1));
    const dark = style.theme === "dark";
    const bg = style.bg || (dark ? "#20212b" : "#ffffff");
    const textColor = style.text_color || (dark ? "#f0f0f5" : "#1a1a2a");
    const radius = style.radius ?? 12;
    const shadowCss =
      style.shadow === "none"
        ? "none"
        : style.shadow === "strong"
          ? "0 12px 44px rgba(0,0,0,.38)"
          : "0 4px 24px rgba(0,0,0,.18)";
    const maxWidth = Math.min(Math.max(style.width ?? 680, 220), 900);
    const px = (n: number) => Math.round(n * scale) + "px";

    const host = document.createElement("div");
    host.id = "pushvault-prompt";
    // 3. fixed overlay — pointer-events pass through everywhere except the banner
    host.style.cssText =
      mode === "float"
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
    }
    wrap.innerHTML =
      '<div class="pv-bar" role="dialog" aria-label="Notification opt-in">' +
      (style.logo ? '<img class="pv-logo" src="' + style.logo + '" alt="">' : "") +
      '<span class="pv-head"></span>' +
      '<span class="pv-actions">' +
      '<button class="pv-yes"></button>' +
      '<button class="pv-no"></button>' +
      '<button class="pv-x" aria-label="Dismiss">&#10005;</button>' +
      "</span></div>";
    const noBg = dark ? "#34353f" : "#f5f5f7";
    const noColor = dark ? "#d5d5dd" : "#333";
    const noBorder = dark ? "#4a4b55" : "#ddd";
    const css = document.createElement("style");
    css.textContent =
      ".pv-bar{pointer-events:auto;display:flex;align-items:center;gap:" + px(12) + ";flex-wrap:wrap;" +
      (mode === "float" ? "margin:0;" : "margin:8px auto;max-width:" + maxWidth + "px;") +
      "padding:" + px(12) + " " + px(16) + ";border-radius:" + radius + "px;background:" + bg + ";color:" + textColor + ";" +
      "box-shadow:" + shadowCss + ";font:" + px(14) + "/1.4 system-ui,sans-serif;}" +
      ".pv-logo{width:" + px(28) + ";height:" + px(28) + ";border-radius:6px;object-fit:cover}" +
      ".pv-head{flex:1;min-width:140px;font-weight:600}" +
      ".pv-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}" +
      "button{cursor:pointer;border-radius:" + Math.max(4, Math.round(radius * 0.66)) + "px;font:600 " + px(13) + " system-ui,sans-serif;padding:" + px(8) + " " + px(14) + ";border:1px solid " + noBorder + ";background:" + noBg + ";color:" + noColor + "}" +
      ".pv-yes{background:" + accent + ";border-color:" + accent + ";color:#fff}" +
      ".pv-x{border:none;background:none;font-size:" + px(12) + ";color:#999;padding:4px 6px}";
    shadow.appendChild(css);
    shadow.appendChild(wrap);

    (shadow.querySelector(".pv-head") as HTMLElement).textContent =
      text.headline || "Get notified about updates?";
    const yesBtn = shadow.querySelector(".pv-yes") as HTMLButtonElement;
    const noBtn = shadow.querySelector(".pv-no") as HTMLButtonElement;
    yesBtn.textContent = text.yes || "Yes, notify me";
    noBtn.textContent = text.no || "No thanks";

    const remove = () => host.remove();
    yesBtn.addEventListener("click", async () => {
      yesBtn.disabled = true;
      yesBtn.textContent = "…";
      remove();
      await doSubscribe(cfg.vapid_public_key);
    });
    noBtn.addEventListener("click", () => {
      setChoice("no");
      remove();
    });
    (shadow.querySelector(".pv-x") as HTMLButtonElement).addEventListener("click", () => {
      setChoice("no");
      remove();
    });

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
    if (trigger.type === "scroll") {
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
      const UNIT_MS = { seconds: 1000, minutes: 60_000, hours: 3600_000, days: 86400_000 };
      const cooldownMs =
        reask.cooldown_value != null
          ? reask.cooldown_value * (UNIT_MS[reask.cooldown_unit ?? "days"] ?? 86400_000)
          : (reask.cooldown_days ?? 7) * 86400_000;
      if (Date.now() - prior.ts < cooldownMs) return;
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
  };
  (window as any).PushVault = PushVault;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void init());
  } else {
    void init();
  }
})();

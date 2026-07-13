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
  text?: { headline?: string; yes?: string; no?: string };
  style?: {
    position?: "top" | "bottom";
    accent?: string;
    logo?: string | null;
    size?: "compact" | "normal" | "large";
  };
  reask?: { enabled?: boolean; cooldown_days?: number };
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
  const CONFIG_TTL = 3600_000; // 1h

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

  async function fetchConfig(): Promise<RemoteConfig | null> {
    try {
      const cached = localStorage.getItem(LS_CONFIG);
      if (cached) {
        const { ts, data } = JSON.parse(cached);
        if (Date.now() - ts < CONFIG_TTL) return data;
      }
    } catch {
      /* ignore */
    }
    try {
      const res = await fetch(API + "/prompt-config?property_key=" + encodeURIComponent(propertyKey!));
      if (!res.ok) return null;
      const data = (await res.json()) as RemoteConfig;
      try {
        localStorage.setItem(LS_CONFIG, JSON.stringify({ ts: Date.now(), data }));
      } catch {
        /* ignore */
      }
      return data;
    } catch {
      return null;
    }
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
      const reg = await navigator.serviceWorker.register("/pv-sw.js");
      await navigator.serviceWorker.ready;
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

  function renderBanner(cfg: RemoteConfig) {
    const pc = cfg.prompt_config ?? {};
    const text = pc.text ?? {};
    const style = pc.style ?? {};
    const accent = style.accent || "#7C3AED";
    const position = style.position === "bottom" ? "bottom" : "top";
    const sizes = {
      compact: { font: "12.5px", pad: "8px 12px", btn: "6px 10px", logo: 22 },
      normal: { font: "14px", pad: "12px 16px", btn: "8px 14px", logo: 28 },
      large: { font: "16px", pad: "16px 22px", btn: "10px 18px", logo: 36 },
    } as const;
    const sz = sizes[style.size ?? "normal"] ?? sizes.normal;

    const host = document.createElement("div");
    host.id = "pushvault-prompt";
    // 3. fixed banner — overlays nothing interactive, never blocks scroll/clicks
    host.style.cssText =
      "position:fixed;" + position + ":0;left:0;right:0;z-index:2147483000;pointer-events:none;";
    const shadow = host.attachShadow({ mode: "closed" });

    const wrap = document.createElement("div");
    wrap.innerHTML =
      '<div class="pv-bar" role="dialog" aria-label="Notification opt-in">' +
      (style.logo ? '<img class="pv-logo" src="' + style.logo + '" alt="">' : "") +
      '<span class="pv-head"></span>' +
      '<span class="pv-actions">' +
      '<button class="pv-yes"></button>' +
      '<button class="pv-no"></button>' +
      '<button class="pv-x" aria-label="Dismiss">&#10005;</button>' +
      "</span></div>";
    const css = document.createElement("style");
    css.textContent =
      ".pv-bar{pointer-events:auto;display:flex;align-items:center;gap:12px;flex-wrap:wrap;" +
      "margin:8px;padding:" + sz.pad + ";border-radius:12px;background:#fff;color:#1a1a2a;" +
      "box-shadow:0 4px 24px rgba(0,0,0,.18);font:" + sz.font + "/1.4 system-ui,sans-serif;" +
      "max-width:680px;margin-left:auto;margin-right:auto;}" +
      ".pv-logo{width:" + sz.logo + "px;height:" + sz.logo + "px;border-radius:6px;object-fit:cover}" +
      ".pv-head{flex:1;min-width:180px;font-weight:600}" +
      ".pv-actions{display:flex;gap:8px;align-items:center}" +
      "button{cursor:pointer;border-radius:8px;font:600 " + sz.font + " system-ui,sans-serif;padding:" + sz.btn + ";border:1px solid #ddd;background:#f5f5f7;color:#333}" +
      ".pv-yes{background:" + accent + ";border-color:" + accent + ";color:#fff}" +
      ".pv-x{border:none;background:none;font-size:12px;color:#999;padding:4px 6px}";
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
    beaconPageview();
    const prior = getChoice();
    if (prior) {
      if (prior.choice === "subscribed" || prior.choice === "yes") return;
      // "no": re-ask only if configured, after cooldown
      const cfg0 = await fetchConfig();
      if (!cfg0) return;
      const reask = cfg0.prompt_config?.reask;
      if (!reask?.enabled) return;
      const cooldownMs = (reask.cooldown_days ?? 7) * 86400_000;
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

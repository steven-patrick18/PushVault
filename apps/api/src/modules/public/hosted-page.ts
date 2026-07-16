/**
 * Branded hosted opt-in page — served on a property's own subdomain (e.g.
 * alerts.example.com) pointed at this server. Solves the case where the main
 * site can't host pv-sw.js (Website Builder / Shopify): here we control the
 * origin, serve pv-sw.js at its root, and render a page with a big subscribe
 * button. Uses the property's prompt design for texts/colors/logo.
 */
function esc(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/**
 * Only allow safe CSS color tokens (hex / rgb(a) / plain names) into the
 * inline stylesheet — the values come from tenant config, so anything else
 * could break out of the CSS context. Falls back on anything unexpected.
 */
function cssColor(v: unknown, fallback: string): string {
  const s = String(v ?? "").trim();
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
  if (/^rgba?\(\s*[\d.,\s%]+\)$/i.test(s)) return s;
  if (/^[a-z]{3,20}$/i.test(s)) return s.toLowerCase();
  return fallback;
}

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

export function renderOptInPage(property: any, cdnBase: string): string {
  const cfg = (property.promptConfig as any) ?? {};
  const text = cfg.text ?? {};
  const style = cfg.style ?? {};
  const accent = cssColor(style.accent, "#7C3AED");
  const headline = esc(text.headline || "Get instant alerts & offers");
  const yes = esc(text.yes || "Enable notifications");
  const noLabel = typeof text.no === "string" && text.no.trim() ? esc(text.no.trim()) : null;
  const brand = esc(property.name || "Notifications");
  const logo = style.logo ? esc(style.logo) : null;

  // theme + design fields from the Prompt designer (the ones that make sense
  // for a full-screen popup card; position/trigger don't apply here)
  const light = style.theme === "light";
  const pageBg = light
    ? "radial-gradient(ellipse at top,#f4f1fb 0%,#e9e9f0 55%)"
    : "radial-gradient(ellipse at top,#1a1030 0%,#0e0e13 55%)";
  const cardBg = cssColor(style.bg, light ? "#ffffff" : "#16161e");
  const cardBorder = light ? "#e2e2ea" : "#2a2a38";
  const textColor = cssColor(style.text_color, light ? "#1a1a2e" : "#e8e8f0");
  const subColor = light ? "#6b6b7b" : "#9a9aad";
  const stepsBg = light ? "#f6f5fb" : "#0f0f16";
  const radius = clampNum(style.radius, 0, 40, 20);
  const btnRadius = Math.min(radius, 16);
  const scale = clampNum(style.scale, 0.7, 1.5, 1);
  const maxW = Math.round(440 * scale);

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${brand} — Notifications</title>
<style>
:root{--accent:${accent}}
*{box-sizing:border-box;margin:0}
body{font-family:system-ui,-apple-system,sans-serif;background:${pageBg};color:${textColor};min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.card{max-width:${maxW}px;width:100%;text-align:center;background:${cardBg};border:1px solid ${cardBorder};border-radius:${radius}px;padding:40px 32px}
.logo{width:64px;height:64px;border-radius:16px;object-fit:cover;margin:0 auto 18px;display:block}
.bell{font-size:56px;margin-bottom:14px}
h1{font-size:24px;line-height:1.25;margin-bottom:10px;color:${textColor}}
p{color:${subColor};font-size:14px;margin-bottom:26px}
button{background:var(--accent);color:#fff;border:none;border-radius:${btnRadius}px;padding:16px 28px;font-size:16px;font-weight:700;cursor:pointer;width:100%;transition:opacity .15s;display:flex;align-items:center;justify-content:center;gap:10px}
button:disabled{opacity:.6;cursor:default}
button.no{background:transparent;color:${subColor};border:1px solid ${cardBorder};margin-top:10px;font-weight:600}
.msg{margin-top:18px;font-size:14px;min-height:20px;line-height:1.5}
.ok{color:#34d399}.err{color:#f87171}.warn{color:#fbbf24}
.foot{margin-top:26px;font-size:11px;color:${subColor};opacity:.7}
.spin{width:18px;height:18px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:sp .7s linear infinite;display:inline-block}
@keyframes sp{to{transform:rotate(360deg)}}
.steps{text-align:left;background:${stepsBg};border:1px solid ${cardBorder};border-radius:12px;padding:16px 18px;margin-top:16px;font-size:13px;line-height:1.7;color:${subColor}}
.steps b{color:${textColor}}
</style></head>
<body>
<div class="card">
  ${logo ? `<img class="logo" src="${logo}" alt="">` : `<div class="bell">🔔</div>`}
  <h1>${headline}</h1>
  <p>Tap the button below and allow notifications to start receiving updates from ${brand}.</p>
  <button id="sub">${yes}</button>
  ${noLabel ? `<button id="no" class="no">${noLabel}</button>` : ``}
  <div class="msg" id="msg"></div>
  <div class="foot">Powered by PushVault · You can turn these off anytime in your browser.</div>
</div>
<script>window.__PV_NO_PROMPT=true;</script>
<script src="${esc(cdnBase)}/pushvault.js" data-property-key="${esc(property.propertyKey)}"></script>
<script>
(function(){
  var btn=document.getElementById('sub'),msg=document.getElementById('msg');
  var label=btn.textContent;
  function set(cls,html){msg.className='msg '+(cls||'');msg.innerHTML=html;}
  function busy(on){
    if(on){btn.disabled=true;btn.innerHTML='<span class="spin"></span> Working…';}
    else{btn.disabled=false;btn.textContent=label;}
  }
  var no=document.getElementById('no');
  if(no){no.addEventListener('click',function(){
    // opened as a popup window → close it; otherwise just dismiss the card
    try{window.close();}catch(e){}
    set('','No problem — you can enable alerts anytime.');no.style.display='none';
  });}
  var ua=navigator.userAgent||'';
  var isIOS=/iPad|iPhone|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  var standalone=window.navigator.standalone===true||window.matchMedia('(display-mode: standalone)').matches;

  function supported(){return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;}

  // iOS/iPadOS only allows web push from a Home-Screen app. Guide the user
  // instead of letting the permission call hang forever ("round and round").
  if(isIOS && !standalone){
    btn.style.display='none';
    set('warn','To get alerts on iPhone/iPad, add this page to your Home Screen first:');
    var s=document.createElement('div');s.className='steps';
    s.innerHTML='1. Tap the <b>Share</b> button '+String.fromCharCode(0x2934)+'<br>2. Choose <b>Add to Home Screen</b><br>3. Open it from the new icon, then tap Enable.';
    msg.after(s);
    return;
  }
  if(!supported()){btn.disabled=true;set('err','This browser does not support notifications. Try Chrome or Edge.');return;}
  if(Notification.permission==='denied'){set('err','Notifications are blocked for this site. Enable them in your browser settings, then reload.');}

  btn.addEventListener('click',async function(){
    busy(true);set('','Waiting for you to tap <b>Allow</b>…');
    // hard timeout so the button can never spin forever (e.g. permission
    // dialog dismissed, service-worker stall)
    var done=false;
    var timer=setTimeout(function(){
      if(done)return;done=true;busy(false);
      set('warn','Still waiting… If no permission popup appeared, make sure notifications aren\\'t blocked, then tap again.');
    },25000);
    try{
      var ok=(window.PushVault&&window.PushVault.subscribe)?await window.PushVault.subscribe():false;
      if(done)return;done=true;clearTimeout(timer);
      if(ok){set('ok','You are subscribed! You can close this page.');btn.textContent='Subscribed';btn.disabled=true;}
      else if(Notification.permission==='denied'){busy(false);set('err','You blocked notifications. Enable them in your browser settings, then tap again.');}
      else{busy(false);set('err','Not subscribed — the request was declined. Tap to try again.');}
    }catch(e){
      if(done)return;done=true;clearTimeout(timer);busy(false);
      set('err','Something went wrong. Please check your connection and try again.');
    }
  });
})();
</script>
</body></html>`;
}

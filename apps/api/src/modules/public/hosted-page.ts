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

export function renderOptInPage(property: any, cdnBase: string): string {
  const cfg = (property.promptConfig as any) ?? {};
  const text = cfg.text ?? {};
  const style = cfg.style ?? {};
  const accent = esc(style.accent || "#7C3AED");
  const headline = esc(text.headline || "Get instant alerts & offers");
  const yes = esc(text.yes || "Enable notifications");
  const brand = esc(property.name || "Notifications");
  const logo = style.logo ? esc(style.logo) : null;

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${brand} — Notifications</title>
<style>
:root{--accent:${accent}}
*{box-sizing:border-box;margin:0}
body{font-family:system-ui,-apple-system,sans-serif;background:radial-gradient(ellipse at top,#1a1030 0%,#0e0e13 55%);color:#e8e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.card{max-width:440px;width:100%;text-align:center;background:#16161e;border:1px solid #2a2a38;border-radius:20px;padding:40px 32px}
.logo{width:64px;height:64px;border-radius:16px;object-fit:cover;margin:0 auto 18px;display:block}
.bell{font-size:56px;margin-bottom:14px}
h1{font-size:24px;line-height:1.25;margin-bottom:10px}
p{color:#9a9aad;font-size:14px;margin-bottom:26px}
button{background:var(--accent);color:#fff;border:none;border-radius:12px;padding:16px 28px;font-size:16px;font-weight:700;cursor:pointer;width:100%;transition:opacity .15s;display:flex;align-items:center;justify-content:center;gap:10px}
button:disabled{opacity:.6;cursor:default}
.msg{margin-top:18px;font-size:14px;min-height:20px;line-height:1.5}
.ok{color:#34d399}.err{color:#f87171}.warn{color:#fbbf24}
.foot{margin-top:26px;font-size:11px;color:#5a5a68}
.spin{width:18px;height:18px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:sp .7s linear infinite;display:inline-block}
@keyframes sp{to{transform:rotate(360deg)}}
.steps{text-align:left;background:#0f0f16;border:1px solid #2a2a38;border-radius:12px;padding:16px 18px;margin-top:16px;font-size:13px;line-height:1.7;color:#c7c7d4}
.steps b{color:#fff}
</style></head>
<body>
<div class="card">
  ${logo ? `<img class="logo" src="${logo}" alt="">` : `<div class="bell">🔔</div>`}
  <h1>${headline}</h1>
  <p>Tap the button below and allow notifications to start receiving updates from ${brand}.</p>
  <button id="sub">${yes}</button>
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

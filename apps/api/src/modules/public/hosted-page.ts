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
button{background:var(--accent);color:#fff;border:none;border-radius:12px;padding:16px 28px;font-size:16px;font-weight:700;cursor:pointer;width:100%;transition:opacity .15s}
button:disabled{opacity:.55;cursor:default}
.msg{margin-top:18px;font-size:14px;min-height:20px}
.ok{color:#34d399}.err{color:#f87171}
.foot{margin-top:26px;font-size:11px;color:#5a5a68}
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
  function supported(){return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;}
  if(!supported()){btn.disabled=true;msg.className='msg err';msg.textContent='This browser does not support notifications.';return;}
  if(typeof Notification!=='undefined' && Notification.permission==='denied'){msg.className='msg err';msg.textContent='Notifications are blocked. Enable them in your browser settings, then reload.';}
  btn.addEventListener('click',async function(){
    btn.disabled=true;msg.className='msg';msg.textContent='Requesting permission…';
    try{
      var ok=(window.PushVault&&window.PushVault.subscribe)?await window.PushVault.subscribe():false;
      if(ok){msg.className='msg ok';msg.textContent='✅ You are subscribed! You can close this page.';btn.textContent='Subscribed';}
      else{msg.className='msg err';msg.textContent='Not subscribed — permission was declined or unavailable.';btn.disabled=false;}
    }catch(e){msg.className='msg err';msg.textContent='Something went wrong. Please try again.';btn.disabled=false;}
  });
})();
</script>
</body></html>`;
}

/**
 * Server-rendered customer-care directory template (SEO-first). Every public
 * page is plain HTML so Google indexes it. Ad slots carry AdSense (when the
 * site has a publisher id) and a PushVault direct-ad zone. A prominent
 * "not affiliated" disclaimer sits on every page — this template must only
 * ever list OFFICIAL, public contact details.
 */

type Site = {
  name: string;
  domain: string;
  tagline?: string | null;
  adsenseClient?: string | null;
  themeColor?: string;
  _base?: string; // internal-link prefix (preview mode)
};
type Company = {
  slug: string;
  name: string;
  category: string;
  logoUrl?: string | null;
  phones: string[];
  emails: string[];
  website?: string | null;
  hours?: string | null;
  content?: string | null;
};

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

// internal link helper: on a real directory host base is "" (root URLs); in the
// dashboard-host preview it's "/d" so nav stays inside the preview.
function L(site: Site, path: string): string {
  return esc(((site as any)._base || "") + path);
}

const DISCLAIMER =
  "This is an independent directory of publicly available customer-care contact details. " +
  "We are NOT affiliated with, endorsed by, or representing any of the brands listed. " +
  "All trademarks belong to their respective owners. Always verify numbers on the company's official website.";

function adsenseHead(site: Site): string {
  if (!site.adsenseClient) return "";
  return (
    `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(site.adsenseClient)}" crossorigin="anonymous"></script>`
  );
}

function adSlot(site: Site, label: string): string {
  // AdSense auto-fills when configured; otherwise a neutral placeholder that
  // also marks where a PushVault direct-sold ad would render.
  if (site.adsenseClient) {
    return `<ins class="adsbygoogle" style="display:block" data-ad-client="${esc(site.adsenseClient)}" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle=window.adsbygoogle||[]).push({});</script>`;
  }
  return `<div class="ad-slot" data-pv-ad="1" aria-hidden="true">Advertisement · ${esc(label)}</div>`;
}

function layout(site: Site, title: string, bodyHtml: string, desc: string): string {
  const accent = esc(site.themeColor || "#7C3AED");
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='22' fill='${encodeURIComponent(accent)}'/%3E%3Ctext x='50' y='68' font-size='60' text-anchor='middle' fill='white'%3E%F0%9F%93%9E%3C/text%3E%3C/svg%3E">
${adsenseHead(site)}
<style>
:root{--a:${accent}}
*{box-sizing:border-box;margin:0}
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a24;background:#f6f7fb;line-height:1.55}
a{color:var(--a);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:960px;margin:0 auto;padding:0 16px}
header{background:#fff;border-bottom:1px solid #e6e6ee;position:sticky;top:0;z-index:10}
.bar{display:flex;align-items:center;gap:14px;padding:12px 0}
.logo{font-weight:800;font-size:18px;color:var(--a);white-space:nowrap}
form.search{flex:1;display:flex;gap:8px}
form.search input{flex:1;padding:10px 14px;border:1px solid #d8d8e4;border-radius:10px;font-size:15px}
form.search button{background:var(--a);color:#fff;border:none;border-radius:10px;padding:0 18px;font-weight:600;cursor:pointer}
.hero{background:linear-gradient(135deg,var(--a),#0e0e2a);color:#fff;padding:44px 0 40px;text-align:center}
.hero h1{font-size:30px;margin-bottom:8px}.hero p{opacity:.9}
.hero form{max-width:620px;margin:22px auto 0;display:flex;gap:8px}
.hero input{flex:1;padding:14px 16px;border:none;border-radius:12px;font-size:16px}
.hero button{background:#fff;color:var(--a);border:none;border-radius:12px;padding:0 22px;font-weight:700;cursor:pointer}
main{padding:26px 0 40px}
.cats{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:18px 0}
.cat{background:#fff;border:1px solid #e6e6ee;border-radius:12px;padding:14px;font-weight:600;text-align:center}
h2{font-size:20px;margin:26px 0 12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.card{background:#fff;border:1px solid #e6e6ee;border-radius:12px;padding:16px;display:block;color:inherit}
.card:hover{border-color:var(--a);text-decoration:none}
.card .n{font-weight:700}.card .c{font-size:12px;color:#6a6a7a;margin-top:2px}
.company{background:#fff;border:1px solid #e6e6ee;border-radius:14px;padding:22px}
.company h1{font-size:26px}.tag{display:inline-block;background:#eee;color:#555;font-size:12px;border-radius:20px;padding:3px 10px;margin:6px 0}
.contact{margin:16px 0;border-top:1px solid #eee;padding-top:14px}
.contact .row{display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid #f2f2f7;font-size:16px}
.contact .k{width:90px;color:#6a6a7a;font-size:13px}
.callbtn{margin-left:auto;background:var(--a);color:#fff;padding:8px 16px;border-radius:9px;font-weight:600;font-size:14px}
.content{margin-top:16px;color:#33333f}
.ad-slot{background:#ececf3;border:1px dashed #c7c7d6;border-radius:10px;min-height:90px;display:flex;align-items:center;justify-content:center;color:#9a9aad;font-size:12px;margin:20px 0}
.disc{background:#fff8e6;border:1px solid #f0e2b6;border-radius:10px;padding:12px 14px;font-size:12.5px;color:#7a6a30;margin:22px 0}
footer{background:#14141f;color:#c8c8d4;padding:26px 0;font-size:13px;margin-top:30px}
footer a{color:#b9a6ff}footer .links{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px}
.empty{background:#fff;border:1px solid #e6e6ee;border-radius:12px;padding:30px;text-align:center;color:#6a6a7a}
</style></head>
<body>
<header><div class="wrap bar">
  <a class="logo" href="${L(site, "/")}">📞 ${esc(site.name)}</a>
  <form class="search" action="${L(site, "/search")}" method="get" role="search">
    <input name="q" placeholder="Search a company…" aria-label="Search">
    <button>Search</button>
  </form>
</div></header>
${bodyHtml}
<footer><div class="wrap">
  <div class="links"><a href="${L(site, "/")}">Home</a><a href="${L(site, "/about")}">About</a><a href="${L(site, "/contact")}">Contact</a><a href="${L(site, "/privacy")}">Privacy</a><a href="${L(site, "/disclaimer")}">Disclaimer</a></div>
  <div>${esc(DISCLAIMER)}</div>
  <div style="margin-top:10px;opacity:.6">© ${esc(site.name)}</div>
</div></footer>
</body></html>`;
}

export function renderHome(site: Site, categories: string[], featured: Company[]): string {
  const catHtml = categories.map((c) => `<a class="cat" href="${L(site, "/category/" + encodeURIComponent(c))}">${esc(c)}</a>`).join("");
  const cards = featured
    .map(
      (c) =>
        `<a class="card" href="${L(site, "/c/" + c.slug)}"><div class="n">${esc(c.name)}</div><div class="c">${esc(c.category)}</div></a>`,
    )
    .join("");
  const body = `
<div class="hero"><div class="wrap">
  <h1>${esc(site.tagline || "Find any company's customer care number")}</h1>
  <p>Official, verified contact details — updated regularly.</p>
  <form action="${L(site, "/search")}" method="get"><input name="q" placeholder="e.g. Amazon, SBI, Airtel…" aria-label="Search"><button>Search</button></form>
</div></div>
<main class="wrap">
  ${adSlot(site, "top")}
  ${categories.length ? `<h2>Browse by category</h2><div class="cats">${catHtml}</div>` : ""}
  <h2>Popular companies</h2>
  ${cards ? `<div class="grid">${cards}</div>` : `<div class="empty">No companies added yet.</div>`}
  ${adSlot(site, "bottom")}
</main>`;
  return layout(site, `${site.name} — customer care numbers`, body, site.tagline || `Find customer care contact details of companies. ${site.name}.`);
}

export function renderCompany(site: Site, c: Company): string {
  const phoneRows = c.phones
    .map(
      (p) =>
        `<div class="row"><span class="k">Phone</span><b>${esc(p)}</b><a class="callbtn" href="tel:${esc(p.replace(/[^\d+]/g, ""))}">Call</a></div>`,
    )
    .join("");
  const emailRows = c.emails
    .map((e) => `<div class="row"><span class="k">Email</span><a href="mailto:${esc(e)}">${esc(e)}</a></div>`)
    .join("");
  const siteRow = c.website
    ? `<div class="row"><span class="k">Website</span><a href="${esc(c.website)}" rel="nofollow noopener" target="_blank">Official site ↗</a></div>`
    : "";
  const hoursRow = c.hours ? `<div class="row"><span class="k">Hours</span>${esc(c.hours)}</div>` : "";
  const body = `
<main class="wrap">
  <div class="company">
    <h1>${esc(c.name)} customer care</h1>
    <span class="tag">${esc(c.category)}</span>
    ${adSlot(site, "in-article-top")}
    <div class="contact">${phoneRows}${emailRows}${siteRow}${hoursRow}</div>
    ${c.content ? `<div class="content">${esc(c.content).replace(/\n/g, "<br>")}</div>` : ""}
    <div class="disc">⚠️ ${esc(DISCLAIMER)}</div>
    ${adSlot(site, "in-article-bottom")}
  </div>
</main>`;
  const desc = `${c.name} customer care number, email and contact details. ${site.name}.`;
  return layout(site, `${c.name} customer care number — ${site.name}`, body, desc);
}

export function renderList(site: Site, heading: string, companies: Company[], q?: string): string {
  const cards = companies
    .map(
      (c) =>
        `<a class="card" href="${L(site, "/c/" + c.slug)}"><div class="n">${esc(c.name)}</div><div class="c">${esc(c.category)}</div></a>`,
    )
    .join("");
  const body = `
<main class="wrap">
  <h2>${esc(heading)}</h2>
  ${adSlot(site, "list-top")}
  ${cards ? `<div class="grid">${cards}</div>` : `<div class="empty">No results${q ? ` for “${esc(q)}”` : ""}. Try another name.</div>`}
</main>`;
  return layout(site, `${heading} — ${site.name}`, body, `${heading}. ${site.name}.`);
}

export function renderStatic(site: Site, title: string, html: string): string {
  const body = `<main class="wrap"><div class="company"><h1>${esc(title)}</h1><div class="content">${html}</div></div></main>`;
  return layout(site, `${title} — ${site.name}`, body, `${title} — ${site.name}`);
}

export const STATIC_PAGES: Record<string, { title: string; html: string }> = {
  about: {
    title: "About us",
    html:
      "We are an independent directory that helps people quickly find publicly available customer-care contact details of companies. Our goal is to save you time when you need to reach a company's support team.<br><br>We are not affiliated with any of the brands listed.",
  },
  contact: {
    title: "Contact us",
    html: "Questions or a correction to a listing? Email us and we'll review it. We update details regularly to keep them accurate.",
  },
  privacy: {
    title: "Privacy policy",
    html:
      "We respect your privacy. This site may use cookies and third-party advertising (such as Google AdSense) which may use cookies to serve ads based on your prior visits. You may opt out of personalised advertising via Google Ads Settings. We do not sell personal data.",
  },
  disclaimer: {
    title: "Disclaimer",
    html:
      "This is an independent directory of publicly available customer-care contact details. We are NOT affiliated with, endorsed by, or representing any of the brands listed. All trademarks belong to their respective owners. Always verify numbers on the company's official website before calling.",
  },
};

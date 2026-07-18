// Seed a demo customer-care directory site so the template can be previewed.
// Usage: node scripts/seed-directory.mjs <domain> [tenantEmail]
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const domain = (process.argv[2] || "care.demo").toLowerCase();
const adminEmail = process.argv[3] || process.env.ADMIN_EMAIL || "admin@pushvault.local";

const COMPANIES = [
  { name: "Amazon India", category: "E-commerce", phones: ["1800 3000 9009"], emails: ["cs-reply@amazon.in"], website: "https://www.amazon.in", hours: "24x7",
    content: "To reach Amazon India customer care, call the toll-free number or use the Help section in the app under Your Orders. For refunds and returns, most issues are resolved fastest via chat inside the app. Keep your order ID ready before calling." },
  { name: "Flipkart", category: "E-commerce", phones: ["1800 208 9898"], emails: ["cs@flipkart.com"], website: "https://www.flipkart.com", hours: "24x7",
    content: "Flipkart customer support handles orders, returns, refunds and seller issues. The quickest route is the in-app Help Centre, which offers callback and chat. For payment disputes, keep your transaction reference handy." },
  { name: "State Bank of India (SBI)", category: "Banks", phones: ["1800 1234", "1800 2100"], emails: ["customercare@sbi.co.in"], website: "https://www.onlinesbi.sbi", hours: "24x7",
    content: "SBI's toll-free helplines cover account balance, card blocking, and net-banking support. To block a lost debit/credit card immediately, call the helpline or SMS BLOCK to the registered number from your registered mobile." },
  { name: "HDFC Bank", category: "Banks", phones: ["1800 202 6161", "1860 267 6161"], emails: ["support@hdfcbank.com"], website: "https://www.hdfcbank.com", hours: "24x7",
    content: "HDFC Bank PhoneBanking assists with accounts, cards, loans and net-banking. For fraud or an unauthorised transaction, report it immediately on the 24x7 helpline to freeze the card and start a dispute." },
  { name: "Airtel", category: "Telecom", phones: ["121", "198"], emails: ["121@airtel.com"], website: "https://www.airtel.in", hours: "24x7",
    content: "Airtel customer care handles prepaid, postpaid, broadband and DTH. Dial 121 for general queries and 198 for complaints (toll-free). For faster help, the Airtel Thanks app offers chat support and self-service." },
  { name: "Jio", category: "Telecom", phones: ["199", "1800 889 9999"], emails: ["care@jio.com"], website: "https://www.jio.com", hours: "24x7",
    content: "Reliance Jio support covers recharge, network, and JioFiber issues. Call 199 from a Jio number or use the MyJio app. For new connections and general queries the toll-free line works from any phone." },
  { name: "IRCTC", category: "Travel", phones: ["14646", "0755 6610661"], emails: ["care@irctc.co.in"], website: "https://www.irctc.co.in", hours: "24x7",
    content: "IRCTC customer care assists with train ticket bookings, cancellations, refunds and e-catering. For failed transactions where money was deducted, refunds are usually auto-processed; raise a ticket with your PNR if delayed." },
  { name: "LIC of India", category: "Insurance", phones: ["022 6827 6827"], emails: ["co_crmgrv@licindia.com"], website: "https://licindia.in", hours: "Mon-Sat 8am-8pm",
    content: "LIC customer service helps with policy status, premium payment, and claims. Keep your policy number ready. Premiums can be paid online through the LIC portal or authorised apps, and claim forms are available at any branch." },
];

const site = await prisma.tenant.findFirst({ include: { users: { where: { email: adminEmail } } } });
if (!site) { console.error("No tenant found"); process.exit(1); }
const tenantId = site.id;

let ds = await prisma.directorySite.findUnique({ where: { domain } });
if (!ds) {
  ds = await prisma.directorySite.create({
    data: { tenantId, domain, name: "India Customer Care", tagline: "Find any company's customer care number — fast", themeColor: "#7C3AED" },
  });
  console.log("created site", ds.id, domain);
} else {
  console.log("site exists", ds.id, domain);
}

for (const c of COMPANIES) {
  const slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  await prisma.directoryCompany.upsert({
    where: { siteId_slug: { siteId: ds.id, slug } },
    update: {},
    create: { siteId: ds.id, slug, name: c.name, category: c.category, phones: c.phones, emails: c.emails, website: c.website, hours: c.hours, content: c.content, featured: true },
  });
}
const n = await prisma.directoryCompany.count({ where: { siteId: ds.id } });
console.log(`seeded ${n} companies on ${domain}`);
await prisma.$disconnect();

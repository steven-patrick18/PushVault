import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../infra/prisma.service";
import {
  renderHome,
  renderCompany,
  renderList,
  renderStatic,
  STATIC_PAGES,
} from "./directory.render";

/**
 * Data access for the public directory sites. Uses the system (RLS-bypassing)
 * client because these pages are public and resolved by host, not by a
 * logged-in tenant. A short in-memory cache keeps host lookups cheap.
 */
@Injectable()
export class DirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  private siteCache: { at: number; rows: any[] } | null = null;

  private async sites() {
    const now = Date.now();
    if (!this.siteCache || now - this.siteCache.at > 30_000) {
      const rows = await this.prisma.system.directorySite.findMany({ where: { status: "active" } });
      this.siteCache = { at: now, rows };
    }
    return this.siteCache.rows;
  }

  async siteByHost(host: string | undefined) {
    if (!host) return null;
    const bare = host.toLowerCase().split(":")[0].replace(/\.$/, "");
    const all = await this.sites();
    return all.find((s: any) => s.domain === host || s.domain === bare) ?? null;
  }

  async home(siteId: string) {
    const companies = await this.prisma.system.directoryCompany.findMany({
      where: { siteId },
      orderBy: [{ featured: "desc" }, { views: "desc" }, { name: "asc" }],
      take: 24,
    });
    const cats = await this.prisma.system.directoryCompany.findMany({
      where: { siteId },
      select: { category: true },
      distinct: ["category"],
      orderBy: { category: "asc" },
    });
    return { categories: cats.map((c) => c.category), featured: companies };
  }

  async company(siteId: string, slug: string) {
    const c = await this.prisma.system.directoryCompany.findUnique({
      where: { siteId_slug: { siteId, slug } },
    });
    if (c) {
      // fire-and-forget view count
      this.prisma.system.directoryCompany
        .update({ where: { id: c.id }, data: { views: { increment: 1 } } })
        .catch(() => undefined);
    }
    return c;
  }

  async byCategory(siteId: string, category: string) {
    return this.prisma.system.directoryCompany.findMany({
      where: { siteId, category },
      orderBy: { name: "asc" },
    });
  }

  async search(siteId: string, q: string) {
    const term = q.trim().slice(0, 60);
    if (!term) return [];
    return this.prisma.system.directoryCompany.findMany({
      where: { siteId, name: { contains: term, mode: "insensitive" } },
      orderBy: [{ featured: "desc" }, { name: "asc" }],
      take: 40,
    });
  }

  /**
   * Render a public directory page for a host + path. Returns {status, html}.
   * Called from the host-based router in main.ts (clean root URLs, no /api).
   */
  async renderPage(
    site: any,
    pathname: string,
    query: Record<string, any>,
  ): Promise<{ status: number; html: string }> {
    const p = decodeURIComponent(pathname.replace(/\/+$/, "") || "/");
    if (p === "/" || p === "") {
      const { categories, featured } = await this.home(site.id);
      return { status: 200, html: renderHome(site, categories, featured) };
    }
    let m: RegExpExecArray | null;
    if ((m = /^\/c\/([a-z0-9-]+)$/i.exec(p))) {
      const c = await this.company(site.id, m[1]);
      if (!c) return { status: 404, html: renderList(site, "Not found", []) };
      return { status: 200, html: renderCompany(site, c as any) };
    }
    if ((m = /^\/category\/(.+)$/i.exec(p))) {
      const cat = m[1];
      const rows = await this.byCategory(site.id, cat);
      return { status: 200, html: renderList(site, `${cat} companies`, rows as any) };
    }
    if (p === "/search") {
      const q = String(query.q ?? "");
      const rows = await this.search(site.id, q);
      return { status: 200, html: renderList(site, q ? `Results for “${q}”` : "Search", rows as any, q) };
    }
    const staticKey = p.slice(1);
    if (STATIC_PAGES[staticKey]) {
      const sp = STATIC_PAGES[staticKey];
      return { status: 200, html: renderStatic(site, sp.title, sp.html) };
    }
    return { status: 404, html: renderList(site, "Page not found", []) };
  }
}

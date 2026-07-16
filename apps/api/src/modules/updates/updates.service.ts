import { BadRequestException, Injectable } from "@nestjs/common";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { writeFile, readFile, mkdir } from "node:fs/promises";

const exec = promisify(execFile);
const SEP = "\x1f"; // unit separator — safe against | in commit subjects

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

/**
 * The "Updates" feed. In production the API runs from a Docker image that does
 * NOT contain the .git repo (kept out for size/security), so local `git` is
 * unavailable. There we read the changelog from the GitHub API and compare the
 * deployed commit (baked in at build time as PUSHVAULT_COMMIT) to the latest on
 * the tracked branch. In local dev (repo present) we fall back to local git.
 *
 * "Update now" can't rebuild the container from inside itself, so it drops a
 * request file in a host-mounted control dir; a tiny host watcher (deploy/
 * host-updater.sh via cron) does `git pull` + `docker compose up -d --build`
 * and writes status back. This keeps the container unprivileged (no docker
 * socket) while still giving a real one-click update.
 */
@Injectable()
export class UpdatesService {
  private readonly repoRoot = resolve(process.cwd(), "..", "..");
  private readonly githubRepo = process.env.GITHUB_REPO ?? "steven-patrick18/PushVault";
  private readonly branch = process.env.UPDATE_BRANCH ?? "main";
  private readonly controlDir = process.env.UPDATE_CONTROL_DIR ?? "/control";
  private readonly deployedCommit = (process.env.PUSHVAULT_COMMIT ?? "").trim();

  private async git(args: string[]): Promise<string> {
    const { stdout } = await exec("git", args, { cwd: this.repoRoot, windowsHide: true });
    return stdout.trim();
  }

  private async gitAvailable(): Promise<boolean> {
    try {
      await this.git(["rev-parse", "--is-inside-work-tree"]);
      return true;
    } catch {
      return false;
    }
  }

  async getUpdates(checkRemote = false) {
    // dev / repo-present path: read local git
    if (await this.gitAvailable()) {
      return this.fromLocalGit(checkRemote);
    }
    // production path: read the changelog from GitHub
    return this.fromGithub();
  }

  private async fromLocalGit(checkRemote: boolean) {
    const [log, branch, remote] = await Promise.all([
      this.git(["log", "--pretty=format:%H%x1f%an%x1f%aI%x1f%s", "-100"]).catch(() => ""),
      this.git(["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => this.branch),
      this.git(["remote", "get-url", "origin"]).catch(() => null),
    ]);
    const commits = this.parseLog(log);
    let behind: number | null = null;
    let ahead: number | null = null;
    if (remote && checkRemote) {
      try {
        await this.git(["fetch", "--quiet", "origin"]);
        const counts = await this.git(["rev-list", "--left-right", "--count", `HEAD...origin/${branch}`]);
        const [a, b] = counts.split(/\s+/).map(Number);
        ahead = a;
        behind = b;
      } catch {
        /* remote unreachable */
      }
    }
    return {
      source: "local" as const,
      repo: this.githubRepo,
      branch,
      version: process.env.npm_package_version ?? "0.1.0",
      deployedCommit: null,
      latestCommit: null,
      behind,
      ahead,
      canApply: false, // dev machine: use your terminal
      commits,
    };
  }

  private parseLog(log: string): GitCommit[] {
    return log
      ? log.split("\n").map((line) => {
          const [hash, author, date, subject] = line.split(SEP);
          return { hash, shortHash: (hash ?? "").slice(0, 7), author, date, subject };
        })
      : [];
  }

  private async fromGithub() {
    const base = `https://api.github.com/repos/${this.githubRepo}`;
    const headers = { "User-Agent": "PushVault", Accept: "application/vnd.github+json" };
    let commits: GitCommit[] = [];
    let behind: number | null = null;
    let latest: string | null = null;
    try {
      const res = await fetch(`${base}/commits?sha=${encodeURIComponent(this.branch)}&per_page=30`, {
        headers,
        signal: AbortSignal.timeout(12_000),
      });
      if (res.ok) {
        const rows = (await res.json()) as any[];
        commits = rows.map((c: any) => ({
          hash: c.sha,
          shortHash: String(c.sha ?? "").slice(0, 7),
          author: c.commit?.author?.name ?? c.author?.login ?? "unknown",
          date: c.commit?.author?.date ?? "",
          subject: (c.commit?.message ?? "").split("\n")[0],
        }));
        latest = commits[0]?.hash ?? null;
        if (this.deployedCommit) {
          const idx = commits.findIndex(
            (c) => c.hash.startsWith(this.deployedCommit) || this.deployedCommit.startsWith(c.hash),
          );
          behind = idx === -1 ? null : idx; // how many commits ahead of us
        }
      }
    } catch {
      /* GitHub unreachable — return what we have */
    }
    return {
      source: "github" as const,
      repo: this.githubRepo,
      branch: this.branch,
      version: process.env.npm_package_version ?? "0.1.0",
      deployedCommit: this.deployedCommit ? this.deployedCommit.slice(0, 7) : null,
      latestCommit: latest ? latest.slice(0, 7) : null,
      behind,
      ahead: null,
      canApply: true, // production: host watcher can rebuild
      commits,
    };
  }

  /** Read the host watcher's status file (written by deploy/host-updater.sh). */
  async status() {
    try {
      const raw = await readFile(resolve(this.controlDir, "update.status"), "utf8");
      return JSON.parse(raw);
    } catch {
      return { state: "idle" };
    }
  }

  /**
   * Request a production update: drop a flag file the host watcher acts on.
   * Only meaningful in the container (control dir mounted).
   */
  async requestUpdate() {
    if (await this.gitAvailable()) {
      throw new BadRequestException(
        "This is a local/dev checkout — update with `git pull` in your terminal, not this button.",
      );
    }
    try {
      await mkdir(this.controlDir, { recursive: true }).catch(() => undefined);
      await writeFile(
        resolve(this.controlDir, "update.status"),
        JSON.stringify({ state: "requested", at: new Date().toISOString() }),
        "utf8",
      );
      await writeFile(
        resolve(this.controlDir, "update.request"),
        JSON.stringify({ at: new Date().toISOString() }),
        "utf8",
      );
    } catch {
      throw new BadRequestException(
        "Automatic update isn't configured on this server. Update by running the deploy command over SSH.",
      );
    }
    return { ok: true, state: "requested" };
  }

  /** Legacy local-dev pull (kept for the repo-present case). */
  async pull() {
    if (!(await this.gitAvailable())) return this.requestUpdate();
    const output = await this.git(["pull", "--ff-only", "origin"]);
    return { output };
  }
}

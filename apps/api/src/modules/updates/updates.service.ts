import { Injectable } from "@nestjs/common";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

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
 * The "Updates" feed: reads the product's own git history so the dashboard
 * can show what changed. If a remote is configured, also reports how many
 * commits behind the local checkout is (an update is available).
 */
@Injectable()
export class UpdatesService {
  private readonly repoRoot = resolve(process.cwd(), "..", "..");

  private async git(args: string[]): Promise<string> {
    const { stdout } = await exec("git", args, {
      cwd: this.repoRoot,
      windowsHide: true,
    });
    return stdout.trim();
  }

  async getUpdates(checkRemote = false) {
    const [log, branch, remote] = await Promise.all([
      this.git([
        "log",
        "--pretty=format:%H%x1f%an%x1f%aI%x1f%s",
        "-100",
      ]).catch(() => ""),
      this.git(["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "main"),
      this.git(["remote", "get-url", "origin"]).catch(() => null),
    ]);

    const commits: GitCommit[] = log
      ? log.split("\n").map((line) => {
          const [hash, author, date, subject] = line.split(SEP);
          return { hash, shortHash: hash.slice(0, 7), author, date, subject };
        })
      : [];

    let behind: number | null = null;
    let ahead: number | null = null;
    if (remote && checkRemote) {
      try {
        await this.git(["fetch", "--quiet", "origin"]);
        const counts = await this.git([
          "rev-list",
          "--left-right",
          "--count",
          `HEAD...origin/${branch}`,
        ]);
        const [a, b] = counts.split(/\s+/).map(Number);
        ahead = a;
        behind = b;
      } catch {
        // remote unreachable — leave counts null
      }
    }

    return {
      branch,
      remote,
      version: process.env.npm_package_version ?? "0.1.0",
      behind,
      ahead,
      commits,
    };
  }

  /** Pull latest from origin (only exposed when a remote exists). */
  async pull() {
    const output = await this.git(["pull", "--ff-only", "origin"]);
    return { output };
  }
}

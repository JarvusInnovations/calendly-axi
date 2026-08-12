import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The published package version, read from `package.json` at runtime — no
 * build-time stamping, no `git describe`. The release workflow rewrites
 * `package.json`'s version from the release tag before `npm publish`, so
 * `--version` always prints exactly what shipped (per architecture.md).
 *
 * Resolved from this module's own location so it works identically whether
 * running from source (`src/version.ts`, one level below the repo root) or
 * from the `tsc` build (`dist/src/version.js`, two levels below).
 */
function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(here, "..", "package.json"),
    join(here, "..", "..", "package.json"),
  ]) {
    if (!existsSync(candidate)) continue;
    const parsed = JSON.parse(readFileSync(candidate, "utf-8")) as {
      version?: unknown;
    };
    if (typeof parsed.version === "string" && parsed.version.length > 0) {
      return parsed.version;
    }
  }
  throw new Error("Could not determine calendly-axi package version");
}

export const version = readVersion();

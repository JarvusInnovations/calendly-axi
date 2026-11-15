import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tryFastPath } from "axi-sdk-js/fast-path";
import { version } from "../src/version.js";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BIN_SOURCE = join(REPO_ROOT, "bin", "calendly-axi.ts");
const BUILT_BIN = join(REPO_ROOT, "dist", "bin", "calendly-axi.js");

describe("bin entry: --version fast path", () => {
  it("answers a bare version flag from the leaf version module", () => {
    for (const flag of ["--version", "-v", "-V"]) {
      let written = "";
      const handled = tryFastPath([flag], { version, stdout: { write: (chunk) => (written += chunk) } });
      expect(handled).toBe(true);
      expect(written).toBe(`${version}\n`);
    }
  });

  it("leaves everything else to the full CLI", () => {
    for (const argv of [[], ["doctor"], ["events", "--version"], ["--help"]]) {
      let written = "";
      expect(tryFastPath(argv, { version, stdout: { write: (chunk) => (written += chunk) } })).toBe(false);
      expect(written).toBe("");
    }
  });

  it("imports the command graph only dynamically, after the fast path declines", () => {
    const source = readFileSync(BIN_SOURCE, "utf-8");
    expect(source).toContain(`from "axi-sdk-js/fast-path"`);
    // A static `import ... from "../src/cli.js"` would load every command
    // module before `--version` could answer.
    expect(source).not.toMatch(/^import[^\n]*["']\.\.\/src\/cli\.js["']/m);
    expect(source).toMatch(/await import\(["']\.\.\/src\/cli\.js["']\)/);
  });

  // Needs the `tsc` build (CI builds before it tests); skipped without `dist/`.
  it.skipIf(!existsSync(BUILT_BIN))(
    "the built binary prints exactly the package version",
    () => {
      const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as { version: string };
      const run = spawnSync(process.execPath, [BUILT_BIN, "--version"], {
        encoding: "utf-8",
        env: { PATH: process.env.PATH ?? "", HOME: join(REPO_ROOT, "dist", "no-such-home") },
      });
      expect(run.status).toBe(0);
      expect(run.stdout).toBe(`${pkg.version}\n`);
    },
    60_000,
  );
});

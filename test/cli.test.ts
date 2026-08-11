import { describe, expect, it } from "vitest";
import { AxiError } from "axi-sdk-js";
import { formatError } from "../src/cli.js";

describe("formatError", () => {
  it.each(["USAGE", "UNKNOWN_FLAG", "VALIDATION_ERROR"])("maps %s to exit code 2", (code) => {
    const { exitCode, output } = formatError(new AxiError("bad input", code, ["fix it"]));
    expect(exitCode).toBe(2);
    expect(output).toContain("bad input");
    expect(output).toContain(code);
  });

  it("maps TOKEN_INVALID (a non-usage AxiError) via exitCodeForError, not 2", () => {
    const { exitCode } = formatError(new AxiError("no token", "TOKEN_INVALID", []));
    expect(exitCode).not.toBe(2);
  });

  it("wraps an unexpected non-AxiError throw as INTERNAL_ERROR, exit 1, no stack trace", () => {
    const { exitCode, output } = formatError(new Error("boom: /private/secret/path"));
    expect(exitCode).toBe(1);
    expect(output).toContain("INTERNAL_ERROR");
    expect(output).toContain("unexpected failure");
    expect(output).not.toMatch(/^\s*at /m);
    expect(output).not.toContain("node:internal");
  });

  it("wraps a thrown non-Error value as INTERNAL_ERROR too", () => {
    const { exitCode, output } = formatError("just a string throw");
    expect(exitCode).toBe(1);
    expect(output).toContain("INTERNAL_ERROR");
  });

  it("never renders help block for empty suggestions", () => {
    const { output } = formatError(new AxiError("no suggestions", "SOME_CODE", []));
    expect(output).not.toContain("help[");
  });
});

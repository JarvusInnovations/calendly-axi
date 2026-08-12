import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { moreAvailableHint, paginate, paginationSummary } from "../../src/calendly/paginate.js";

beforeEach(() => {
  process.env.CALENDLY_AXI_DISABLE_HOOKS = "1";
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "calendly-axi-test-"));
  process.env.CALENDLY_ACCESS_TOKEN = "tok_abc";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.CALENDLY_AXI_DISABLE_HOOKS;
  delete process.env.CALENDLY_ACCESS_TOKEN;
});

/** Build a Calendly-style collection page response. */
function page(items: unknown[], nextToken: string | null) {
  return new Response(
    JSON.stringify({
      collection: items,
      pagination: { count: items.length, next_page_token: nextToken },
    }),
    { status: 200 },
  );
}

describe("paginate", () => {
  it("drains a 3-page fixture to completion (complete: true)", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy
      .mockResolvedValueOnce(page([{ id: 1 }, { id: 2 }], "tok-2"))
      .mockResolvedValueOnce(page([{ id: 3 }, { id: 4 }], "tok-3"))
      .mockResolvedValueOnce(page([{ id: 5 }], null));

    const result = await paginate("scheduled_events");
    expect(result.items).toHaveLength(5);
    expect(result.complete).toBe(true);
    expect(result.pages_fetched).toBe(3);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("requests count=100 and forwards page_token", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(page([{ id: 1 }], null));
    await paginate("scheduled_events", { status: "active" });
    const [url] = spy.mock.calls[0]!;
    expect(String(url)).toContain("count=100");
    expect(String(url)).toContain("status=active");
  });

  it("stops at a limit with more available (complete: false), never over-fetching pages", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy
      .mockResolvedValueOnce(page([{ id: 1 }, { id: 2 }], "tok-2"))
      .mockResolvedValueOnce(page([{ id: 3 }, { id: 4 }], "tok-3"));

    const result = await paginate("scheduled_events", {}, 3);
    expect(result.items).toHaveLength(3);
    expect(result.complete).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("reports complete: true when the limit and the drained cursor land on the same page", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(page([{ id: 1 }, { id: 2 }], null));
    const result = await paginate("scheduled_events", {}, 5);
    expect(result.items).toHaveLength(2);
    expect(result.complete).toBe(true);
  });

  it("limit 0 means drain explicitly", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(page([{ id: 1 }], null));
    const result = await paginate("scheduled_events", {}, 0);
    expect(result.complete).toBe(true);
  });
});

describe("paginationSummary / moreAvailableHint", () => {
  it("renders a bare count when complete", () => {
    expect(paginationSummary({ items: [1, 2, 3], complete: true, pages_fetched: 1 })).toEqual({
      count: 3,
      complete: true,
    });
  });

  it("renders a loud 'shown, more available' string when not complete — never a bare number", () => {
    const summary = paginationSummary({ items: [1, 2, 3], complete: false, pages_fetched: 1 });
    expect(summary.count).toBe("3 shown, more available");
    expect(summary.complete).toBe(false);
  });

  it("moreAvailableHint names the flag to raise", () => {
    expect(moreAvailableHint()).toContain("--limit");
    expect(moreAvailableHint("--limit")).toContain("--limit");
  });
});

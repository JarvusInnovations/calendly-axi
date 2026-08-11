import { encode } from "@toon-format/toon";
import type { FieldDef } from "./schema.js";

/**
 * Render a list of items as a TOON table with the given field schema.
 * Returns a raw TOON string (not wrapped in an object) so it can be
 * composed into a larger output.
 *
 *   <name>[N]{col1,col2,col3}:
 *     val1,val2,val3
 *
 * Ported from harvest-axi/gws-axi.
 */
export function renderList(
  name: string,
  items: Array<Record<string, unknown>>,
  schema: FieldDef[],
): string {
  const projected = items.map((item) =>
    Object.fromEntries(schema.map((f) => [f.name, f.extract(item) ?? ""])),
  );
  return encode({ [name]: projected });
}

/** Render a simple key/value object as TOON. */
export function renderObject(value: Record<string, unknown>): string {
  return encode(value);
}

/**
 * Drop `undefined`-valued keys from an object before rendering, so a detail
 * view only shows fields the API actually returned rather than an explicit
 * `field: undefined` — safer than trusting the TOON encoder's handling of
 * absent values, and cleaner output either way.
 */
export function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

/**
 * Render a help array as a multi-line `help[N]:` block — the canonical AXI
 * form used by the first-party chrome-devtools-axi and slack-axi. Formatted
 * manually because `encode()` inlines primitive arrays (`help[N]: a,b,c`);
 * the multi-line block is the readable standard (help is read as guidance,
 * not decoded back). Empty help renders to an empty string.
 */
export function renderHelp(suggestions: string[]): string {
  if (suggestions.length === 0) return "";
  return `help[${suggestions.length}]:\n${suggestions.map((s) => `  ${s}`).join("\n")}`;
}

/** Join rendered blocks with newlines, dropping empty ones. */
export function joinBlocks(...blocks: string[]): string {
  return blocks.filter((b) => b.length > 0).join("\n");
}

/**
 * Compose a list response: optional header, optional summary, the list (or a
 * definitive empty-state message), and optional suggestions. Mirrors
 * harvest-axi/gws-axi's canonical AXI list shape — see
 * `specs/behaviors/pagination-and-limits.md` for the count/complete
 * semantics callers are expected to feed into `summary`.
 */
export function renderListResponse(options: {
  header?: Record<string, unknown>;
  /** Emitted after the header but before the list — e.g. resolved scope/window/count. */
  summary?: Record<string, unknown>;
  name: string;
  items: Array<Record<string, unknown>>;
  schema: FieldDef[];
  suggestions?: string[];
  /** Message when items is empty — replaces the list block entirely. */
  emptyMessage?: string;
}): string {
  const blocks: string[] = [];
  if (options.header) blocks.push(renderObject(options.header));
  if (options.summary) blocks.push(renderObject(options.summary));
  if (options.items.length === 0) {
    // Definitive empty state: a single field whose value is the reason.
    blocks.push(
      renderObject({
        [options.name]: options.emptyMessage ?? `0 ${options.name} found`,
      }),
    );
  } else {
    blocks.push(renderList(options.name, options.items, options.schema));
  }
  if (options.suggestions?.length) {
    blocks.push(renderHelp(options.suggestions));
  }
  return joinBlocks(...blocks);
}

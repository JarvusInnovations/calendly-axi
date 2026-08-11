/**
 * Shared schema builders for TOON table rendering. Each FieldDef is a
 * projection from a source object (usually a Calendly API resource) onto a
 * named column in the output table.
 *
 * Ported from harvest-axi/gws-axi (proven; not reinvented) — same API so
 * rendering matches the sibling *-axi tools.
 */

export interface FieldDef {
  name: string;
  extract: (item: Record<string, unknown>) => unknown;
}

export function field(name: string): FieldDef {
  return { name, extract: (item) => item[name] };
}

export function lower(name: string): FieldDef {
  return {
    name,
    extract: (item) => {
      const value = item[name];
      return typeof value === "string" ? value.toLowerCase() : value;
    },
  };
}

/** Pull a nested field, e.g. `owner.name` → `owner_name` (or an alias). */
export function pluck(parent: string, child: string, alias?: string): FieldDef {
  return {
    name: alias ?? `${parent}_${child}`,
    extract: (item) => {
      const parentVal = item[parent] as Record<string, unknown> | undefined;
      return parentVal?.[child];
    },
  };
}

export function mapEnum(
  name: string,
  mapping: Record<string, string>,
  fallback: string,
  alias?: string,
): FieldDef {
  return {
    name: alias ?? name,
    extract: (item) => {
      const value = item[name];
      if (typeof value !== "string") return fallback;
      return mapping[value] ?? fallback;
    },
  };
}

/** Compute a column from the whole item (derived values). */
export function computed(
  name: string,
  fn: (item: Record<string, unknown>) => unknown,
): FieldDef {
  return { name, extract: fn };
}

/** Truncate a string to `max` chars with an ellipsis; passes non-strings through. */
export function truncated(name: string, max: number, alias?: string): FieldDef {
  return {
    name: alias ?? name,
    extract: (item) => {
      const value = item[name];
      if (typeof value !== "string") return value;
      return value.length > max ? `${value.slice(0, max - 1)}…` : value;
    },
  };
}

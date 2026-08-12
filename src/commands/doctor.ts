import { calendlyRequest, getRateLimitInfo } from "../calendly/client.js";
import { uuidFromUri } from "../calendly/ids.js";
import { fetchProfile } from "../calendly/scope.js";
import { readConfig, resolveCredentials } from "../config.js";
import { DOCTOR_FLAGS, parseFlags } from "../flags.js";
import { joinBlocks, renderList, renderObject } from "../output/index.js";
import { hookDoctorCheck } from "./setup.js";

/** `doctor` — five ordered checks; see `specs/commands/auth.md#doctor`. */

interface Check {
  check: string;
  status: "ok" | "fail" | "skipped";
  detail: string;
}

const CHECK_SCHEMA = [
  { name: "check", extract: (i: Record<string, unknown>) => i.check },
  { name: "status", extract: (i: Record<string, unknown>) => i.status },
  { name: "detail", extract: (i: Record<string, unknown>) => i.detail },
];

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function rateLimitCheck(): Check {
  const info = getRateLimitInfo();
  if (info?.remaining === undefined || info.limit === undefined) {
    return { check: "rate-limit headroom", status: "skipped", detail: "no rate-limit headers captured yet" };
  }
  const freeTier = info.limit <= 50;
  return {
    check: "rate-limit headroom",
    status: "ok",
    detail: `${info.remaining}/${info.limit} remaining this minute${freeTier ? " — Free-tier ceiling (50/min), shared across all callers of the account" : ""}`,
  };
}

function finish(checks: Check[]): string {
  const healthy = !checks.some((c) => c.status === "fail");
  if (!healthy) process.exitCode = 1;
  return joinBlocks(
    renderObject({ healthy }),
    renderList("checks", checks as unknown as Array<Record<string, unknown>>, CHECK_SCHEMA),
  );
}

export async function doctorCommand(args: string[]): Promise<string> {
  parseFlags("doctor", args, DOCTOR_FLAGS);

  const checks: Check[] = [];
  const creds = resolveCredentials();

  // 1. credentials
  if (!creds) {
    checks.push({
      check: "credentials",
      status: "fail",
      detail: "none found — run `calendly-axi auth setup --token <pat>`",
    });
    checks.push({ check: "token", status: "skipped", detail: "no credentials to validate" });
    checks.push({ check: "organization", status: "skipped", detail: "no credentials to validate" });
    checks.push({ check: "rate-limit headroom", status: "skipped", detail: "no live calls were made" });
    checks.push(hookDoctorCheck());
    return finish(checks);
  }
  checks.push({ check: "credentials", status: "ok", detail: `present (source: ${creds.source})` });

  // 2. token
  const started = Date.now();
  let profile: Awaited<ReturnType<typeof fetchProfile>>;
  try {
    profile = await fetchProfile(creds);
    checks.push({
      check: "token",
      status: "ok",
      detail: `authenticated as ${profile.name} <${profile.email}> (${Date.now() - started}ms)`,
    });
  } catch (err) {
    checks.push({ check: "token", status: "fail", detail: errMessage(err) });
    checks.push({ check: "organization", status: "skipped", detail: "token check failed first" });
    checks.push(rateLimitCheck());
    checks.push(hookDoctorCheck());
    return finish(checks);
  }

  // 3. organization — org URI cached and fetchable?
  try {
    await calendlyRequest(`organizations/${uuidFromUri(profile.organization_uri)}`, { credentials: creds });
    const cachedOrg = readConfig().profile_cache?.organization_uri;
    let detail = profile.organization_uri;
    if (!cachedOrg) {
      detail += " (not cached — run `calendly-axi auth setup` to cache your profile)";
    } else if (cachedOrg !== profile.organization_uri) {
      detail += " (differs from the cached value — re-run `calendly-axi auth setup`)";
    }
    checks.push({ check: "organization", status: "ok", detail });
  } catch (err) {
    checks.push({ check: "organization", status: "fail", detail: errMessage(err) });
  }

  // 4. rate-limit headroom
  checks.push(rateLimitCheck());

  // 5. hooks
  checks.push(hookDoctorCheck());

  return finish(checks);
}

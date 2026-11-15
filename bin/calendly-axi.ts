#!/usr/bin/env node
import { tryFastPath } from "axi-sdk-js/fast-path";
import { version } from "../src/version.js"; // leaf module, node builtins only

// Answer a bare --version without loading the command graph.
if (!tryFastPath(process.argv.slice(2), { version })) {
  const { main } = await import("../src/cli.js");
  main();
}

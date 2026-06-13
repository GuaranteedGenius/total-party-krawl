#!/usr/bin/env node
// PostToolUse(Edit|Write): format .ts/.js with prettier if available. Dormant until installed.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

let data = {};
try { data = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }
const fp = (data.tool_input || {}).file_path || "";
if (!/\.(ts|js|mjs|cjs)$/.test(fp)) process.exit(0);
if (/[\\/]\.claude[\\/]hooks[\\/]/.test(fp)) process.exit(0); // don't reformat hooks

try {
  execFileSync("npx", ["--no-install", "prettier", "--write", fp], { stdio: "ignore", shell: true });
} catch {
  process.stderr.write("ts-lint-format: prettier not installed yet, skipping\n");
}
process.exit(0);

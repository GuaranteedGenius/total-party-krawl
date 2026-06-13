#!/usr/bin/env node
// PreToolUse(Edit|Write|Bash): block touching/staging secret files.
import { readFileSync } from "node:fs";

const SECRET = /(^|[\\/])\.env(\.local|\.[^\\/]*\.local)?$/i;

let input = "";
try { input = readFileSync(0, "utf8"); } catch { process.exit(0); }
let data = {};
try { data = JSON.parse(input); } catch { process.exit(0); }

const tool = data.tool_name || "";
const ti = data.tool_input || {};

function block(msg) { process.stderr.write(`secret-guard: ${msg}\n`); process.exit(2); }

if ((tool === "Edit" || tool === "Write") && ti.file_path && SECRET.test(ti.file_path)) {
  block(`refusing to write secret file ${ti.file_path}. Secrets must never be edited by the agent.`);
}
if (tool === "Bash" && typeof ti.command === "string") {
  const c = ti.command;
  if (/\bgit\s+add\b/.test(c) && /\.env(\.|\b)/.test(c)) {
    block(`refusing to 'git add' a .env file. Secrets must never be staged.`);
  }
}
process.exit(0);

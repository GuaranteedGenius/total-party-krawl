#!/usr/bin/env node
// PreToolUse(Bash): warn (non-blocking) when git-adding a .glb whose .import is missing.
import { readFileSync, existsSync } from "node:fs";

let data = {};
try { data = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }
const ti = data.tool_input || {};
if ((data.tool_name || "") !== "Bash") process.exit(0);
const cmd = ti.command || "";
if (!/\bgit\s+add\b/.test(cmd)) process.exit(0);

const globs = cmd.match(/\S+\.glb\b/g) || [];
for (const g of globs) {
  const importPath = g.replace(/(['"])$/, "") + ".import";
  if (!existsSync(importPath)) {
    process.stderr.write(`godot-asset-guard: ${g} has no committed .import sidecar — Godot needs it. Import the asset in the editor and commit the .import too.\n`);
  }
}
process.exit(0);

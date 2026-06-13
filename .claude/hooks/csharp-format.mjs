#!/usr/bin/env node
// PostToolUse(Edit|Write): run dotnet format on edited .cs files if a solution exists.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";

let data = {};
try { data = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }
const ti = data.tool_input || {};
const fp = ti.file_path || "";
if (!fp.endsWith(".cs")) process.exit(0);

// Find a .sln upward from the game dir; bail quietly if none yet.
const gameDir = "E:/repos/twitch/total-party-krawl/game";
let sln = null;
try { sln = readdirSync(gameDir).find(f => f.endsWith(".sln")); } catch {}
if (!sln) { process.stderr.write("csharp-format: no .sln yet, skipping\n"); process.exit(0); }

const dotnet = "C:/Program Files/dotnet/dotnet.exe";
try {
  execFileSync(dotnet, ["format", `${gameDir}/${sln}`, "--include", fp], { stdio: "ignore" });
} catch (e) {
  process.stderr.write(`csharp-format: dotnet format failed (non-fatal)\n`);
}
process.exit(0);

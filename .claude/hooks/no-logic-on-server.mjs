#!/usr/bin/env node
// PreToolUse(Edit|Write): advisory warning if game-logic keywords appear in api/.
import { readFileSync } from "node:fs";

let data = {};
try { data = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }
const ti = data.tool_input || {};
const fp = (ti.file_path || "").replace(/\\/g, "/");
if (!/(?:^|\/)api\//.test(fp)) process.exit(0);

const body = ti.content || ti.new_string || "";
const LOGIC = /(resolveTurn|applyDamage|calculateDamage|rollDodge|dexOrder|combat|cooldownTick|hpAfter|takeDamage)/i;
if (LOGIC.test(body)) {
  process.stderr.write("no-logic-on-server: this looks like GAME LOGIC under api/. The server is a thin relay — combat/turn/damage logic belongs in the Godot client. Reconsider before proceeding.\n");
}
process.exit(0);

# Blender → Godot: Character & Boss Assets

How to author the alpha characters in Blender so they drop straight into Total Party Krawl.
The current models (`player_base_model_male_1`, `boss_test_model`) are placeholders; these
replace them with distinct, animated class meshes.

> The two things that make assets "just work" here: **flat-color materials** (no textures — our
> cel shader reads the material base color) and **exact animation clip names** (so the combat
> code can play them). Match those and import is plug-and-play.

---

## 1. What to make (the asset list)

Four characters, low-poly, stylized:

| File name (exact) | Character | Notes |
|---|---|---|
| `char_tank.glb`   | Tank   | bulky/armored; reads as the "soak" |
| `char_mage.glb`   | Mage   | slight/robed; the glass cannon |
| `char_healer.glb` | Healer | supportive look |
| `boss_warden.glb` | The Warden (boss) | **bigger** than the party (~1.5–2×); heavy/menacing |

Start with **one** (e.g. `char_tank.glb`) end-to-end so we validate the pipeline before you do all four.

### Scale & orientation
- Humanoid party ≈ **1.7 m** tall; boss noticeably larger.
- Model **facing −Y in Blender** (the glTF exporter converts to Godot's −Z "forward"); they'll face the camera/boss correctly, and we can spin them in-scene if needed.
- **Apply all transforms** before export: select → `Ctrl+A` → *All Transforms* (location/rotation/scale). Scale must be 1.0.

### Materials — IMPORTANT (flat color, no textures)
Our look is a per-material **cel shader that uses the material's base color** — there are **no image textures** in this project. So:
- Use **one material per flat color region** (e.g. skin, shirt, metal, hair). Set **Base Color** on a Principled BSDF; that's it.
- **No image textures, no texture painting, no UV-baked detail.** Detail comes from geometry + separate materials, not maps.
- Name materials clearly (e.g. `tank_armor`, `tank_skin`) — the names carry into Godot and make assigning the cel look easy.

### Rig + animations (exact clip names)
Rig each character with an **Armature**. Author these **Actions**, named **exactly** (lowercase):

| Clip name | When it plays | Loop? |
|---|---|---|
| `idle`   | default resting pose | **yes** |
| `attack` | physical attacks (Basic Attack, Shield Bash, boss Crushing Blow/Quake) | no |
| `cast`   | spells/heals (Fireball, Heal, Mend, Taunt, boss Brace) | no |
| `hurt`   | taking damage | no |
| `die`    | on death | no (hold last frame) |

A character missing a clip is fine — the code falls back to the existing tween (lunge/flash) for that action. `idle` is the most important; do that + `attack` first.

---

## 2. Export from Blender

`File → Export → glTF 2.0 (.glb/.gltf)`:

- **Format:** glTF Binary (`.glb`)
- **Include:** Selected Objects (select your character + its armature) — or whole scene if it's just the one character
- **Transform:** ✅ +Y Up
- **Data → Mesh:** ✅ Apply Modifiers; ✅ Materials (Export)
- **Data → Skinning:** ✅ (export the armature/weights)
- **Animation:** ✅ Animation; ✅ **Group by NLA Track** *(or)* ✅ Use All Actions — so every named Action exports as its own clip. ✅ set `idle` to loop (or we set loop on import).
- Name the output exactly per the table (`char_tank.glb`, …).

Quick self-check before exporting: one mesh + one armature, transforms applied, materials are flat Base Colors, actions named `idle`/`attack`/`cast`/`hurt`/`die`.

---

## 3. Import into Godot

1. Put the `.glb` in **`game/assets/`** (same folder as the current models). Godot auto-imports on focus and writes a `.glb.import` sidecar — **commit both** the `.glb` (it's Git-LFS tracked) and the `.import`.
2. Double-click the `.glb` in the FileSystem dock → the **Import** tab. Confirm:
   - It imports as a **Scene** with a `Skeleton3D` + `MeshInstance3D` + an **`AnimationPlayer`** containing your clips.
   - In the AnimationPlayer, set `idle` to **Loop** if it isn't (or use the import "Animation → set loop" option).
3. That's all you need to do — ping me here and I'll wire it up (next section).

---

## 4. What I wire up once the `.glb` is in `game/assets/` (my side)

You don't do these — tell me the file's in and I'll:
- **Cel materials:** create per-region cel `.tres` (from each material's base color) and apply them as surface overrides, so the new mesh matches the cel + screen-space-outline look (same pattern as the existing props).
- **Class → mesh mapping:** point the combat scenes (`combat.tscn` offline + `live.tscn`) at `char_tank/mage/healer.glb` per `classId`, and `boss_warden.glb` for the boss, replacing the tinted placeholder.
- **Animation playback:** drive the `AnimationPlayer` from combat events in `CombatantView` — `idle` by default, `attack`/`cast` on actions, `hurt` on damage, `die` on death (falling back to the current tweens for any missing clip).
- **Framing:** adjust per-character scale/offset and re-check the 3/4 camera.

---

## 5. Suggested order
1. Author **`char_tank.glb`** with `idle` (+ `attack` if quick), flat materials, exported per §2.
2. Drop it in `game/assets/`, import, commit.
3. Tell me — I wire it in and screenshot it in `combat.tscn` so you can see it live before doing the other three + boss.

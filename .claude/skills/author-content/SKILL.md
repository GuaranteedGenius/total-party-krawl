---
name: author-content
description: Scaffold and validate a data-driven content entry (class, boss, enemy, or move) against the project schema. Use when adding or editing game content. SCAFFOLD — refined once game-designer defines the concrete schemas.
---

# author-content

Data-driven content workflow for Total Party Krawl. Classes, bosses, enemies, and moves are
DATA consumed by the Godot client, never hardcoded.

## Status: SCAFFOLD
The concrete schema (Godot Resource format vs JSON, field names, file locations) is owned by the
game-designer agent and not yet finalized. Until then:

1. Ask the game-designer agent for the current schema before authoring content.
2. Place content where the gameplay engineer expects it (game/data/ once established).
3. Validate required fields for the content type:
   - Class: name, role (Tank/Mage/Healer), base stats (STR/INT/DEX/CON), abilities[].
   - Boss/Enemy: name, archetype, stats, move set, AI behavior (enemies only).
   - Move: name, cost/cooldown, target rule, effect (damage/heal/buff/taunt), stat scaling.

## To be built when the schema lands
- A validator that checks an entry against the schema and reports missing/invalid fields.
- A scaffolder that emits a correctly-shaped template for a chosen content type.

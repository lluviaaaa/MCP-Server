# dnd-swamp: Project State

## Goal
Write an encounter table and a loot table for the Mire of Rot swamp region (party level 3 to 5), following the rules in swamp_region.md.

## Acceptance criteria
1. Both tables follow the rules in swamp_region.md: 10 rows each, the right columns, plain-number weights.
2. In each table the weight column adds up to exactly 100, and no TODO, FIXME or TBD is left (checked with audit_loot_table).
3. Every creature and item fits the region (nothing forbidden), and a short encounter_guide.md explains how to use the tables.

## Status
Complete (session 3). Reviewer findings fixed and verified.
- Criterion 1: met. Reviewer confirmed 10 rows, columns and plain-number weights in session 2; my edits changed only one value or row each.
- Criterion 2: met. audit_loot_table on encounters.csv and loot.csv: 10 rows, total 100, no placeholders, no invalid weights.
- Criterion 3: met. The forbidden battery lantern was replaced by a Reed-Wrapped Marsh Lantern (Frog Folk Hunter). The loot creatures are now allowed ones (L07 set to Drowned Zombie). encounter_guide.md was written (15 lines). I did not re-read swamp_region.md; creature names were checked against the reviewer's session 2 findings.

## Fixes made in session 3
- encounters.csv: E01 Giant Frog weight 15 -> 20 (total 95 -> 100).
- loot.csv: L06 replaced (weight 8 kept); L07 source_creature TODO -> Drowned Zombie.

## Next steps
1. Optional: a final reviewer pass against swamp_region.md (in "dnd swamp/", with a space).
2. Optional: playtest the tables.

## Key files
- dnd swamp/swamp_region.md (region rules; note the folder name has a space, not a hyphen)
- dnd-swamp/encounters.csv, dnd-swamp/loot.csv (final tables)
- dnd-swamp/encounter_guide.md (how to roll and the three hazards)
- dnd-swamp/PLAN_LOG.md, CHECKPOINTS.md, DECISIONS.md (logs)

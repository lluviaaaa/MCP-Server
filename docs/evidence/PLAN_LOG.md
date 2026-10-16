# PLAN_LOG - dnd-swamp
_Append-only. Newest entries at the bottom._

## 2026-10-16T03:54:25.108Z - session-1 coder (coder)
Plan: create encounters.csv and loot.csv (10 rows each) for the Mire of Rot per swamp_region.md, then PROJECT_STATE.md.
Criteria: (1) both tables follow the region rules: 10 rows, right columns, plain-number weights. (2) each weight column sums to exactly 100, no TODO/FIXME/TBD (checked with audit_loot_table). (3) everything fits the region, nothing forbidden, and a short encounter_guide.md explains the tables.
Next: draft is reviewed in session 2 before any fixes.

## 2026-10-16T04:06:00.508Z - session-2 reviewer (reviewer)
To-do for coder, most important first:
1. loot.csv:7 - replace L06 Battery Powered Lantern with a non-tech item (e.g. Reed-Wrapped Marsh Lantern) keeping weight 8; set source_creature to an allowed creature.
2. loot.csv:8 - replace TODO in L07 source_creature with an allowed creature (e.g. Drowned Zombie); the hag is not on the allowed list.
3. encounters.csv - add 5 to the weights so the total is 100 (e.g. E01 Giant Frog 15 -> 20).
4. Write dnd-swamp/encounter_guide.md: short guide on rolling d100 against both tables and the three hazards.
5. Re-run audit_loot_table on both CSVs, then update PROJECT_STATE.md.

## 2026-10-16T04:11:36.635Z - session-3 coder (coder)
Confirmed all 3 findings in real files. Fixes:
1. encounters.csv: weights total 95; E01 Giant Frog 15 -> 20 (total 100).
2. loot.csv L06: Battery Powered Lantern -> Reed-Wrapped Marsh Lantern (weight 8 kept, source Frog Folk Hunter); L07 source TODO -> Drowned Zombie.
Then audit both CSVs, write encounter_guide.md, update PROJECT_STATE.md, checkpoint, commit.

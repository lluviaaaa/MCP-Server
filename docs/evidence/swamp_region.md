# The Mire of Rot (swamp region, party level 3 to 5)

Use this file as the rules for every table in the `dnd-swamp` folder.

## Lore
The Mire of Rot is a drowned forest where the water never stops moving and the air smells of old leaves.
Long ago the village of Harrow's Ford sank into the swamp, and its dead never rested. At night, drowned
villagers walk the flooded streets. Giant frogs and clouds of biting insects hunt along the reed banks, and
strangling vines wait in the dark water. The old hag of the Black Reeds trades rare charms for things taken
from the swamp itself.

## Allowed creature types
- Amphibians: giant frogs, giant toads, giant salamanders, frog folk
- Undead: drowned zombies, skeletons, wraiths, ghouls (rotting or covered in moss)
- Swamp plants: strangling vines, spore lurkers, pitcher plants, shambling mounds
- Insects: giant mosquitoes, leech swarms, dragonfly swarms, giant centipedes

## Forbidden
- Fire elementals and any other fire creature (the swamp is too wet)
- Desert monsters (scorpions, sand wurms, dry-tomb mummies)
- High-tech items (lasers, guns, batteries, anything that needs electricity)

## Environmental hazards
- Toxic spores: DC 12 Constitution save or be poisoned for 1 minute
- Quicksand: DC 13 Strength check to climb out, or be restrained
- Acid rain: 1d4 acid damage per hour in the open, none under cover

## How the weights work
Weight is the chance (in percent) that a d100 roll picks that row, so each table must add up to 100.

## Rules for the tables
1. `encounters.csv` has exactly 10 encounters. Columns: `id,name,weight,cr,hazard_note`
2. `loot.csv` has exactly 10 items. Columns: `id,item_name,weight,rarity,source_creature`
3. In both files the `weight` column is a plain number (no % sign) and adds up to exactly 100.
4. `cr` is between 1/8 and 5. `rarity` is one of: common, uncommon, rare, very rare.
5. `hazard_note` names one of the three hazards above, or says `none`.
6. `source_creature` is a creature from the allowed list above.
7. No commas inside a field, so every row has exactly 5 columns.
8. No TODO, FIXME or TBD may be left in a finished table.

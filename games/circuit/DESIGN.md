# Circuit Runner design notes

Premise, "The Great Defrag": ONE (a simple automation robot) and TASK (a robo-Pomeranian) save their motherboard home from a Garbage Collector.

## Abilities
- ONE: Interrupt Jump (freezes pulsing hazards); Register Load (carries exactly one item).
- TASK: Pointer Fetch (goes into vents and highlights secrets); Queue Attack (bites and holds enemies); Buffer Overflow Bark (stuns all enemies for 2s).

## Stages
1. Breadboard Suburbs: jumper cables are ziplines and ropes; vias are elevators.
2. Copper Highway: traces are conveyor belts; cracked traces cause a short circuit; colour cycling gives a glowing look.
3. Logic Gate Labyrinth: AND gate (ONE on a plate, TASK on a switch); XOR gate (only one may occupy it, and both slams it shut).
4. Garbage Collector Chase: forced scroller with a deletion wall on the left.

## Visuals and sound
- DLI palette shift when descending a via (green PCB to dark brown or blue underside).
- Deeper background layers use black, white and grey textures.
- POKEY: distorted industrial beat plus pure square waves for the barks.

## Hazards
Glitch Storm (vertical lines), garbled floor blocks that lose collision, Solder-Wave chase, Bit-Flipper enemy (inverts controls).

## HUD idea
`RAM [|||....] | CORE: 01 | TASK BUFFER`

## Obstacle ideas
Traces, vias, capacitors, resistors, diodes and LEDs, oscillator (rhythm hazards), breadboard (inventory or workbench), logic gates, buses, registers (1-2 item limit), ALU boss.

## Status
Done: ONE/TASK swap, AND-gate door (latched open).
Next: conveyor traces, diodes, resistor slow zones, vias.

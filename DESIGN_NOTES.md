# Design notes

Fill this in as you work. Keep it factual and short; bullet points are fine. Graders read this before your code.

## Challenges

- Challenge 1 — added pure series generation and batched fill operations; styles remain outside the current engine model.

## Data model changes

What you added to or changed in the engine's state, and why. (Row identity? style store? number formats? rules?)

## Engine API

Every method you added to the object returned by `createEngine`, one line each: signature, what it does, what one undo reverts.

- `setCells(entries)` — applies `{ r, c, value }` edits together with one recalculation; one undo restores all changed cells.
- `fillRange(src, dst)` — extends one row or column direction from the source seeds through `fillSeries`; one undo restores the entire fill.
- `fillSeries(seedValues, count, backwards)` — pure helper returning generated raw values for a directional series, including formula reference shifts.

## Undo semantics

For each user action you added: what a single `Ctrl+Z` reverts.

- A batch edit or fill reverts all changed raw cell values in that batch in one undo step; redo reapplies the batch.
## Defects found in the existing code

For each: where, symptom, root cause (two or three sentences), fix.

## Measurements

What you measured, how (production build? which machine? how many runs?), the numbers.

- Fill budget — 5,000 generated cells took 71.47 ms in one local Node runtime measurement using `performance.now()` around `engine.fillRange`; the Vitest regression test also enforces the 200 ms limit.

## AI (if applicable)

- Provider you wired up and why.
- Exact context shape sent to the model.
- How you parse and validate responses; what happens on each failure.
- Anything the golden set disagrees with your implementation on, and why you chose your behaviour.

## Trade-offs and what you would do next

## Use of AI tools

Which tools you used and for what. Nothing here counts against you; we just want to know.

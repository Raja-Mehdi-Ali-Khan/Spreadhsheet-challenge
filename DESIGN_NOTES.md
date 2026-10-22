# Design notes

Fill this in as you work. Keep it factual and short; bullet points are fine. Graders read this before your code.

## Challenges

- Challenge 1 — range selection, editing, batched clear, range formatting and directional fill UI; styles stay in React state.

## Data model changes

What you added to or changed in the engine's state, and why. (Row identity? style store? number formats? rules?)

## Engine API

Every method you added to the object returned by `createEngine`, one line each: signature, what it does, what one undo reverts.

- `setCells(entries)` — applies `{ r, c, value }` edits together with one recalculation; one undo restores all changed cells.
- `fillRange(src, dst)` — extends one row or column direction from the source seeds through `fillSeries`; one undo restores the entire fill.
- `fillSeries(seedValues, count, backwards)` — pure helper returning generated raw values for a directional series, including formula reference shifts.
- `getUsedRange()` — returns the bounding `{ r1, c1, r2, c2 }` of stored non-empty cells (empty sheet is A1); no undo entry.

## Undo semantics

For each user action you added: what a single `Ctrl+Z` reverts.

- A batch edit or fill reverts all changed raw cell values in that batch in one undo step; redo reapplies the batch.
- Delete/Backspace sends the selected rectangle through one `setCells` call; one Ctrl+Z restores all cleared values. Formatting and fill-style copies are React state and are not undoable in this step. A Ctrl+Z after a fill restores filled values; copied styles remain.
## Defects found in the existing code

- Range parsing: range endpoints were not consistently parsed as cell references; normalize both endpoints before evaluating range formulas.
- `parseFloat` text corruption: values such as `10%`, `007`, and dates were partially coerced to numbers. Only complete numeric literals are numbers; other raw text stays intact.
- `$` references: absolute row and column markers were not retained through parsing and fill translation. The reference parser now keeps independent row/column pin flags end to end.
- Unary minus: negative operands were not handled by formula evaluation; the expression parser now accepts unary signs.
- `$` during structural edits: inserting or deleting rows/columns shifted pinned references incorrectly. Structural reference translation now respects pinned coordinates while moving relative references.
- UI single-cell editing: pointer down entered edit mode, so ordinary selection and rectangular formatting were unavailable. Selection and editing are now separate states; single clicks only select.

For each: where, symptom, root cause (two or three sentences), fix.

## Measurements

What you measured, how (production build? which machine? how many runs?), the numbers.

- Fill budget — **70.44 ms** (targeted Vitest run) and **100.76 ms** (full Vitest run) for 5,000 generated cells on Windows with Vitest 3.2.7; these are Node runtime test measurements, not a production build measurement. `src/engine/fill.test.js` seeds a 2 × 50 range before timing, then uses `performance.now()` immediately around `engine.fillRange({ r1: 0, c1: 0, r2: 1, c2: 49 }, { r1: 0, c1: 0, r2: 101, c2: 49 })`; the 100 added rows × 50 columns are exactly 5,000 cells. The test prints elapsed milliseconds and asserts under 200 ms.

## AI (if applicable)

- Provider you wired up and why.
- Exact context shape sent to the model.
- How you parse and validate responses; what happens on each failure.
- Anything the golden set disagrees with your implementation on, and why you chose your behaviour.

## Trade-offs and what you would do next

## Use of AI tools

Which tools you used and for what. Nothing here counts against you; we just want to know.

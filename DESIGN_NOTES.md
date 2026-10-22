# Design notes

## Challenges

- Challenge 1 — range selection, editing, batched clear, range formatting and directional fill.
- Challenge 2 — engine-owned styles, stable row identity, sorting, filters and their UI.

## Data model changes

- Styles are stored in the engine as a sparse map keyed by row and column; style changes shift with structural edits and travel with rows during sorting.
- Each row has a stable numeric rank. Initial ranks are spaced by 1024; insertion assigns a rank between neighbors (or 1024 before/after an edge), deletion removes the rank, and original order sorts by rank.
- Filters are stored by column and normalized checklist values trim whitespace and ignore case; formulas continue to use hidden rows.
- Sorting moves whole rows, including cells outside the selected block, so row data remains together. A trailing totals row is detected when the final used row has `Total`, `Totals`, or `Grand Total` in column A.

## Engine API

Every public engine method added or extended for these challenges, one line each. One undo means the full action listed.

- `setCells(entries)` — applies `{ r, c, value }` edits as one batch; one undo restores every changed raw value.
- `fillRange(src, dst)` — fills a one-dimensional source into the destination and copies seed styles cyclically; one undo restores all filled values and styles.
- `setStyle(r, c, partialStyle)` — merges a style into one cell; one undo restores that cell's prior style.
- `setStyles(entries)` — applies `{ r, c, style }` entries in one batch; one undo restores all prior styles.
- `getStyle(r, c)` — returns a copy of a cell's style; no undo entry.
- `getUsedRange()` — returns the stored non-empty cell bounds, or A1 for an empty sheet; no undo entry.
- `sortRange(block, columnIndex, direction)` — sorts data rows by `asc`, `desc`, or stable row-id `original`; one undo restores row values, styles, ids and formula references.
- `setFilter(columnIndex, filterOrNull)` — sets or removes one column's `{ values, condition }` filter; one undo restores the previous filter state.
- `clearFilters()` — clears every active filter; one undo restores them.
- `isRowHidden(r)` — reports whether a data row fails active filters; no undo entry.
- `getVisibleRowCount()` — counts visible data rows, excluding header and detected totals row; no undo entry.
- `getDistinctValues(columnIndex)` — returns first-seen display labels, with `(Blanks)` for empty cells; no undo entry.
- `getFilter(columnIndex)` — returns a copy of one column's filter or `null`; no undo entry.
- `getFilters()` — returns a copy of the filter map; no undo entry.
- `hasActiveFilters()` — reports whether any filters are active; no undo entry.

## Undo semantics

- A multi-cell clear, range style action, or fill is one action. Fill undo restores both values and copied styles.
- A sort is one action and undo restores row order, styles, stable ids and rewritten formulas.
- Setting one filter or clearing all filters is one action; undo restores the prior filter view.
- Redo reapplies the same action. Styles live in the engine so sorting, fill and style actions share the same undo history.

## Defects found in the existing code

- Range parsing normalized range endpoints before evaluation so ranges are interpreted as cell references consistently.
- `parseFloat` corrupted text such as `10%`, `007`, and dates. Raw cells now become numbers only when the entire value is a plain numeric literal; formula range coercion keeps percentage and date text intact.
- `$` references lost row/column pin information during parsing and fill. The parser retains independent absolute row and column flags through translation.
- Unary minus was not evaluated correctly. The expression parser now accepts unary signs.
- Structural row/column edits shifted pinned references. Reference translation now preserves pinned coordinates and shifts relative references.
- Pointer down previously began editing immediately. Selection and editing now have separate state; single click selects and the formula bar follows the anchor cell.

## Measurements

- Fill budget — 53.42 ms for 5,000 generated cells in the final full Vitest run, on Windows with Vitest 3.2.7. `src/engine/fill.test.js` seeds 2 × 50 cells before timing, then calls `performance.now()` immediately before and after `engine.fillRange({ r1: 0, c1: 0, r2: 1, c2: 49 }, { r1: 0, c1: 0, r2: 101, c2: 49 })`; the 100 added rows × 50 columns are exactly 5,000 cells. The timing is a Node engine test, not a production build, and the test asserts under 200 ms.
- Synthetic sort — ten timed sorts of 10,000 data rows (fixture setup excluded), using `performance.now()` around `sortRange` in Vitest's Node runtime: median 63.87 ms, min 48.72 ms, max 128.64 ms. The test asserts each run is under 300 ms; this is not a production build measurement.
- Large sample date sort — `loadSampleLarge` fixture load was completed before timing; `performance.now()` surrounded `sortRange(engine.getUsedRange(), 1, 'asc')` in the same Node/Vitest run: 194.86 ms.

## Trade-offs and next steps

- Column labels keep the Challenge 1 click-to-select behavior. Separate small sort and filter buttons avoid making selection clicks unexpectedly sort data.
- Sorting uses whole-row movement to preserve row integrity. When a formula range overlaps only part of the sorted block, each endpoint that maps to a moved row follows that row; a range spanning the entire sortable block stays unchanged.
- Blank keys remain last in both directions. Text comparison ignores case and preserves input order for equal keys; dates in ISO, M/D/YYYY, and D Mon YYYY formats compare as dates.
- Totals detection is intentionally limited to the last used row and the labels `Total`, `Totals`, and `Grand Total` in column A.

## Use of AI tools

- Codex assisted with implementation, code review and test runs.

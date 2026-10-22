# Design notes

## Challenges

- Challenge 1 — range selection, editing, batched clear, range formatting and directional fill.
- Challenge 2 — engine-owned styles, stable row identity, sorting, filters and their UI.
- Challenge 4 — Ask your data, deterministic query plans and read-only results.

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

- Fill budget — 68.41 ms for 5,000 generated cells in the final full Vitest run, on Windows with Vitest 3.2.7. `src/engine/fill.test.js` seeds 2 × 50 cells before timing, then calls `performance.now()` immediately before and after `engine.fillRange({ r1: 0, c1: 0, r2: 1, c2: 49 }, { r1: 0, c1: 0, r2: 101, c2: 49 })`; the 100 added rows × 50 columns are exactly 5,000 cells. The timing is a Node engine test, not a production build, and the test asserts under 200 ms.
- Synthetic sort — ten timed sorts of 10,000 data rows (fixture setup excluded), using `performance.now()` around `sortRange` in Vitest's Node runtime: median 64.61 ms, min 47.71 ms, max 117.08 ms. The test asserts each run is under 300 ms; this is not a production build measurement.
- Large sample date sort — `loadSampleLarge` fixture load was completed before timing; `performance.now()` surrounded `sortRange(engine.getUsedRange(), 1, 'asc')` in the same Node/Vitest run: 258.67 ms.

## Trade-offs and next steps

- Column labels keep the Challenge 1 click-to-select behavior. Separate small sort and filter buttons avoid making selection clicks unexpectedly sort data.
- Sorting uses whole-row movement to preserve row integrity. When a formula range overlaps only part of the sorted block, each endpoint that maps to a moved row follows that row; a range spanning the entire sortable block stays unchanged.
- Blank keys remain last in both directions. Text comparison ignores case and preserves input order for equal keys; dates in ISO, M/D/YYYY, and D Mon YYYY formats compare as dates.
- Totals detection is intentionally limited to the last used row and the labels `Total`, `Totals`, and `Grand Total` in column A.

## Use of AI tools

- Codex assisted with implementation, code review and test runs. No AI-generated values enter query results: the provider only proposes a plan and the local executor calculates every result.

## Challenge 5 — Format with AI

### Data model, API and undo

- `numberFormat` (`general`, `number`, `currency`, `percent`, `date`) is another sparse style property in the engine's existing per-cell style map. The engine keeps the raw cell value unchanged; the grid applies formatting only while rendering cell content. Formula-bar values remain raw.
- Frozen row counts remain engine state through `getFrozen` / `setFrozen`; column widths use `getColWidth` / `setColWidth`. All three state types are in structural snapshots, so insert/delete and undo shift styles with their cells.
- `engine.batch(fn)` — groups changes made by ordinary engine APIs inside `fn` into one snapshot undo entry; nested calls join the outer transaction, exceptions restore the starting snapshot, and no-op transactions create no entry.
- `planFormat(action, sheetInfo)` — returns final changed style entries, freeze request, changed widths, auto-fit flag, result code and plain-language description; pure and React-free.
- `describeFormat(action)` — turns the action into a short preview description; pure and React-free.
- `formatDisplay(value, numberFormat)` — formats display text without changing cell storage; pure and React-free, using the query executor's `toNum` and `toDate` helpers.
- Applying an action calls `engine.batch` once. One undo restores every touched style, frozen row count and width; `NO_CHANGES` and `OUT_OF_RANGE` produce no undo entry.

### Formatting rules and trade-offs

- The applier folds operations in contract order: clear used-range styles, body style, body-only column styles, detected totals style, then header style. It strips a header number format and never lets a column entry apply alignment or a number format to the header. Out-of-range columns and widths are ignored.
- Totals detection checks the last used row's first filled label against the contract regex, then checks the summary-line rule (non-numeric label, numeric tail, at least two filled values and a blank cell). A non-total last row drops `totalsStyle`.
- Auto-fit uses a documented text-width approximation: longest rendered/raw string length × 7.5 px + 24 px, clamped to 48–400 px. It runs after explicit widths and styles and can be replaced by canvas `measureText` if font-accurate browser sizing becomes important.
- The UI previews the validated action and description; Apply computes a plan against the current sheet and runs it in one transaction. Discard changes no sheet state. The panel displays `APPLIED`, `NO_CHANGES` or `OUT_OF_RANGE`.
- Golden fixture discrepancies: f03 expects J22 to be blank, but `sales.tsv` row 22 contains `$3,344.00` in J22 (`ORD-1020`). f06 expects one undo for clearing formatting on an initially unformatted fixture; per the contract's no-op rule this is `NO_CHANGES` with no undo. The test reports these two discrepancies and verifies the observed behavior instead of falsifying sheet data or creating a fake undo entry.

### Measurements

- Large clean-table action — **151.98 ms median**. Method: parse `sales-large.tsv` and load it into one engine with `setCells` before timing; in Vitest's Node runtime, `performance.now()` surrounds `readSheet`/plan construction plus `engine.batch` application for 10 runs, with `engine.undo()` between runs outside the timed interval; sort the ten durations and take the mean of the middle two. Auto-fit measures the formatted displayed text with the documented character-width approximation. The test asserts under 300 ms.

## Challenge 4 — Ask your data

### Provider and request context

- The default provider is the deterministic local mock for offline repeatability. The optional HTTP provider uses a plain OpenAI-compatible chat-completions request because this wire format is also supported by several hosted services and local Ollama deployments; only `src/ai/provider.js` knows that protocol. Endpoint, model and optional bearer key come from `VITE_AI_ENDPOINT`, `VITE_AI_MODEL` and `VITE_AI_API_KEY`.
- The provider receives the instruction, JSON action rules and serialized sheet context in `system`. Its `user` field is exactly the typed prompt, with no context appended, because the golden mock matches this raw string. `history` is an array of `{ role, content }` turns and contains the prior typed prompts and raw assistant responses.
- The actual context object has this shape: `{ range: string, rowCount: number, columns: [{ name: string, index: number, type: 'number'|'currency'|'percent'|'date'|'text'|'id', examples: string[] }], sampleRows: string[][], selection: string, hasTotalsRow: boolean }`. `sampleRows` contains no more than five data rows and examples no more than three per column. The full computed-value matrix stays in the local executor and is never sent to the provider.

### Parsing, validation, execution and failures

- `extractJson` scans for the first balanced object, respecting quoted braces and escapes, and parses only that substring. Missing, incomplete or invalid JSON becomes `INVALID_RESPONSE` with a detail. `validateAction` checks action schemas, required fields, types, enums, additional fields and numeric bounds; validation errors include the failing JSON path. Unknown action types yield `READ_ONLY`; the query executor accepts only `query`, while validated `format_sheet` actions go to the Challenge 5 preview/applier path.
- `executeQuery` resolves exact case-insensitive trimmed header names, normalizes and precomputes source columns, then deterministically filters, groups, aggregates, sorts and caps results. Unknown source and sort columns return `UNKNOWN_COLUMN` and `UNKNOWN_SORT_COLUMN`; unknown operators and aggregates return `UNKNOWN_OP` and `UNKNOWN_FN`. The UI asks which column was intended on `UNKNOWN_COLUMN`, displays clarify questions directly, and displays provider, parse, validation and read-only errors without changing the sheet.
- Re-run calls the stored query plan against the current local sheet without calling a provider. Insert writes result headers and values through one `engine.setCells` batch and therefore creates one undo step; out-of-grid targets are refused. The conversation history is shown in the panel.
- The 20 query golden cases pass, including the intended `UNKNOWN_COLUMN` and `READ_ONLY` refusal cases. No disagreement with `fixtures/ai-eval/queries.json` remains.

### Engine API and undo

- `readSheet(engine)` — reads computed formula results and source raw values from the used range into a local 2D array; no undo entry.
- `executeQuery(sheetRows, plan)` — runs a validated read-only plan and returns columns, rows, rowCount and truncated, or a coded error; no undo entry.
- `engine.setCells(entries)` — writes inserted headers and values as one batch; one undo restores every inserted cell's prior value.

### Measurements

- Query budget — **4.38 ms median** for golden q01 on `sales-large.tsv`. Measurement method: `loadSampleLarge` and `readSheet` run before timing in the Vitest Node process; `performance.now()` immediately surrounds each of 10 `executeQuery(rows, q01Plan)` calls; sorted timings use the midpoint mean of runs 5 and 6. Budget: under 50 ms.
- Generated grouping budget — **151.14 ms median** for a two-key group-by over 100,000 generated data rows. Measurement method: generate the in-memory rows before timing in the Vitest Node process; `performance.now()` surrounds each of 10 `executeQuery` calls; sorted timings use the midpoint mean of runs 5 and 6. Budget: under 500 ms.


## Challenge 3 — virtualized grid at scale

### Data model and layout

- The app starts with a sparse 100,000 × 200 engine. Empty cells are not allocated; row identity ranks are the engine's existing stable row IDs.
- The engine stores sparse column-width and row-height overrides (defaults: 120 px and 24 px), and a frozen row/column count. Size maps and frozen settings are included in snapshots, so structural edits and undo restore them. Insert/delete shifts width and height overrides with their columns/rows.
- `src/grid/layout.js` builds cumulative prefix offsets, finds the row/column at an offset by binary search, skips zero-height filtered rows, and adds four-item overscan. The app only creates cells in that viewport plus frozen rows and columns. Memoized cells receive primitive data; pointer actions are delegated at the grid container.
- Filtered rows report layout height zero while retaining their engine row number. The existing selection, fill, sort, style and filter operations use engine coordinates.

### Engine API added

- `getColWidth(columnIndex)` — returns the override or 120 px; no undo entry.
- `setColWidth(columnIndex, width)` — stores one width override in one undoable snapshot action.
- `getRowHeight(rowIndex)` — returns 0 for a filtered row, otherwise the override or 24 px; no undo entry.
- `setRowHeight(rowIndex, height)` — stores one height override in one undoable snapshot action.
- `getFrozen()` — returns a copy of `{ rows, cols }`; no undo entry.
- `getLayoutVersion()` — returns the version for size, hidden-row, and structural layout changes; no undo entry.
- `setFrozen({ rows, cols })` — sets frozen row/column counts in one undoable snapshot action.
- `stats.lastRecalcCount` — reports cells recalculated by the most recent engine recalculation; diagnostic only, no undo entry.

### Undo semantics

- A width or height committed after a resize gesture is one snapshot action and one Ctrl+Z restores the prior size map.
- A freeze change is one snapshot action. Insert/delete row or column keeps the size overrides with their row/column and its existing structural undo restores the prior sizes.
- Existing batch edits, fills, sorts and filter actions retain their Challenge 1 and 2 undo behavior.

### Defects found and fixed

- Cache invalidation on every edit discarded unrelated formula results. Cell edits now dirty only that cell and its transitive dependents; structural changes and sorting still rebuild and invalidate the full graph/cache.
- `removeAllDependencies` (implemented as `removeDependencies`) previously risked removing reverse edges that belonged to dependents. Removing a formula now deletes only its outgoing precedent edges and its own range records.
- Range references tracked only endpoints, so editing an interior cell did not recalculate `=SUM(A1:A5)`. Ranges are interval records indexed by covered column; changing a cell checks the relevant intervals without creating one graph edge per cell.
- Recalculation had quadratic queue operations and membership checks. Kahn ordering now uses a queue index and sets, and dirty closure traversal is iterative.
- Recursive dependency traversal and evaluation could overflow on long chains. Dependent traversal is iterative and recalculation evaluates in topological order so already resolved precedents are cached before dependents run; unresolved cycle members receive `#CYCLE!`.
- Blank references returned text and caused arithmetic errors. A blank cell resolves to numeric zero in formulas while its display remains blank.

### Measurements

Measurements below are Node/Vitest engine runs, not production browser measurements. In the final full test run, filling `K2` from `=J2*2` through row 100,000 took **1,556.98 ms**. `sales-large.tsv` loading and the seed edit happened before `performance.now()`; the timer surrounds only `engine.fillRange({r1:1,c1:10,r2:1,c2:10}, {r1:1,c1:10,r2:99999,c2:10})`.

With 50,000 formula cells across rows 50,001–100,000, the median of 20 `performance.now()` measurements around editing `J95000` with `setCell(94999, 9, value)` plus reading its dependent `K95000` with `getCell(94999, 10)` was **0.08 ms** (min 0.06 ms, max 0.29 ms). Setup is outside the timed loop. A separate assertion confirms an edit with no dependents recalculates exactly one cell using `stats.lastRecalcCount`.

No browser numbers are claimed for first paint, 60 fps scrolling, or key latency. To measure them on the production build, run `npm run build` and `npm run preview`, then open the preview URL with `?perf=1`. Load **Sample 3k**, use the name box to reach `K2`, enter `=J2*2`, press Enter, and reselect `K2`. Drag its fill handle to the bottom edge of the grid and hold while the grid auto-scrolls; release when row 100,000 is under the pointer. This fills through the final row. Open browser DevTools **Performance**, record a reload for first paint. Then load **Sample 3k** again, record scrolling to row 95,000 and editing `J95000`; read scroll frames and scripting/commit time in the Performance trace alongside the overlay's commit count, last commit duration, last scroll-frame duration, and visible-cell count. Repeat on the production build before reporting production budgets.

### Trade-offs

- The grid keeps a single scroll container and positions only visible cells in a large sizer. Frozen first-row/first-column layers are synced by translating the small rendered set on scroll; the remaining cells scroll normally.
- Prefix arrays rebuild after a size, filter visibility, or structural-layout change. Ordinary cell edits do not rebuild them. Scroll range state changes only when the visible row/column bounds change.
- Auto-fit measures loaded display strings with a character-width approximation and caps columns at 400 px. Browser canvas text measurement can replace this if font-accurate auto-fit is needed.

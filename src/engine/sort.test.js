import { describe, expect, it } from 'vitest'
import { createEngine } from './core.js'
import { loadSampleLarge, loadSampleSmall } from '../fixtures/loadSample.js'

function salesEngine(loader = loadSampleSmall) {
    const engine = createEngine(50, 50)
    loader(engine)
    return engine
}

function rawColumn(engine, column, start, end) {
    return Array.from({ length: end - start + 1 }, (_, index) => engine.getCell(start + index, column).raw)
}

describe('sort and filter engine', () => {
    it('sorts sales rows with formulas following rows, blanks last, and totals pinned', () => {
        const engine = salesEngine()
        engine.setCell(1, 10, '=J2/G2')
        engine.fillRange({ r1: 1, c1: 10, r2: 1, c2: 10 }, { r1: 1, c1: 10, r2: 31, c2: 10 })
        const used = engine.getUsedRange()

        engine.sortRange(used, 9, 'desc')

        expect(engine.getCell(1, 10).computed).toBe(1080)
        expect(engine.getCell(32, 0).raw).toBe('Total')
        expect(engine.getCell(31, 0).raw).toBe('')
        expect(engine.undo()).toBe(true)
        expect(engine.getCell(1, 0).raw).toBe('ORD-1001')
    })

    it('normalizes West values, leaves hidden rows in place, and undo restores sort then filter', () => {
        const engine = salesEngine()
        const original = rawColumn(engine, 0, 0, 32)
        engine.setFilter(2, { values: ['West'] })
        expect(engine.getDistinctValues(2).filter(value => value.toLocaleLowerCase().trim() === 'west')).toEqual(['West'])
        const hiddenBefore = new Map()
        for (let row = 1; row < 32; row++) if (engine.isRowHidden(row)) hiddenBefore.set(row, engine.getCell(row, 0).raw)
        expect(hiddenBefore.size).toBeGreaterThan(0)

        engine.sortRange(engine.getUsedRange(), 6, 'asc')
        for (const [row, value] of hiddenBefore) expect(engine.getCell(row, 0).raw).toBe(value)
        expect(engine.undo()).toBe(true)
        expect(engine.undo()).toBe(true)
        expect(engine.getFilters().size).toBe(0)
        expect(rawColumn(engine, 0, 0, 32)).toEqual(original)
    })

    it('cycles ascending, descending, and original order using stable row ids', () => {
        const engine = salesEngine()
        const original = rawColumn(engine, 0, 1, 31)
        const block = engine.getUsedRange()
        engine.sortRange(block, 6, 'asc')
        engine.sortRange(block, 6, 'desc')
        engine.sortRange(block, 6, 'original')
        expect(rawColumn(engine, 0, 1, 31)).toEqual(original)
    })

    it('moves and restores styles with sorted rows and structural edits', () => {
        const engine = salesEngine()
        engine.setStyle(1, 0, { bold: true, color: '#123456' })
        const originalStyle = engine.getStyle(1, 0)
        engine.sortRange(engine.getUsedRange(), 6, 'desc')
        const movedRow = Array.from({ length: 32 }, (_, row) => row).find(row => engine.getCell(row, 0).raw === 'ORD-1001')
        expect(engine.getStyle(movedRow, 0)).toEqual(originalStyle)
        expect(engine.undo()).toBe(true)
        expect(engine.getStyle(1, 0)).toEqual(originalStyle)

        engine.insertRow(1)
        expect(engine.getStyle(2, 0)).toEqual(originalStyle)
        engine.deleteRow(1)
        expect(engine.getStyle(1, 0)).toEqual(originalStyle)
        expect(engine.undo()).toBe(true)
        expect(engine.getStyle(2, 0)).toEqual(originalStyle)
        expect(engine.undo()).toBe(true)
        expect(engine.getStyle(1, 0)).toEqual(originalStyle)
    })

    it('combines filters with AND, applies conditions, and restores filter state with undo', () => {
        const engine = createEngine(8, 3)
        engine.setCells([
            { r: 0, c: 0, value: 'Region' }, { r: 0, c: 1, value: 'Units' },
            { r: 1, c: 0, value: 'West' }, { r: 1, c: 1, value: '15' },
            { r: 2, c: 0, value: 'West ' }, { r: 2, c: 1, value: '5' },
            { r: 3, c: 0, value: 'North' }, { r: 3, c: 1, value: '20' },
            { r: 4, c: 0, value: 'west' }, { r: 4, c: 1, value: '' }
        ])
        engine.setFilter(0, { values: ['West'] })
        engine.setFilter(1, { condition: { op: 'gt', value: '10' } })
        expect([1, 2, 3, 4].filter(row => !engine.isRowHidden(row))).toEqual([1])
        expect(engine.getVisibleRowCount()).toBe(1)
        expect(engine.getDistinctValues(0)).toEqual(['West', 'North'])
        expect(engine.getDistinctValues(1)).toContain('(Blanks)')

        engine.clearFilters()
        expect(engine.hasActiveFilters()).toBe(false)
        expect(engine.undo()).toBe(true)
        expect(engine.getFilters().size).toBe(2)
        expect(engine.undo()).toBe(true)
        expect(engine.getFilters().size).toBe(1)
        expect(engine.undo()).toBe(true)
        expect(engine.getFilters().size).toBe(0)
    })

    it('batches range styles and fill style copying into undoable engine actions', () => {
        const engine = createEngine(5, 5)
        engine.setCells([{ r: 0, c: 0, value: 'Item 1' }, { r: 1, c: 0, value: 'Item 2' }])
        engine.setStyles([
            { r: 0, c: 0, style: { bold: true, color: '#111111' } },
            { r: 1, c: 0, style: { italic: true, color: '#222222' } }
        ])
        engine.setStyle(2, 0, { bg: '#ffff99' })

        engine.fillRange({ r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 3, c2: 0 })
        expect(engine.getStyle(2, 0)).toEqual({ bold: true, color: '#111111' })
        expect(engine.getStyle(3, 0)).toEqual({ italic: true, color: '#222222' })
        expect(engine.undo()).toBe(true)
        expect(engine.getCell(2, 0).raw).toBe('')
        expect(engine.getStyle(2, 0)).toEqual({ bg: '#ffff99' })
        expect(engine.getStyle(3, 0)).toEqual({})
    })

    it('sorts numeric, date, text, case-tied, and blank values consistently', () => {
        const engine = createEngine(8, 2)
        engine.setCells([
            { r: 0, c: 0, value: 'Header' },
            { r: 1, c: 0, value: '10' },
            { r: 2, c: 0, value: '$2.00' },
            { r: 3, c: 0, value: 'zebra' },
            { r: 4, c: 0, value: 'Apple' },
            { r: 5, c: 0, value: 'apple' },
            { r: 6, c: 0, value: '' }
        ])
        engine.sortRange({ r1: 0, c1: 0, r2: 6, c2: 0 }, 0, 'asc')
        expect(rawColumn(engine, 0, 1, 6)).toEqual(['$2.00', '10', 'Apple', 'apple', 'zebra', ''])
        engine.sortRange({ r1: 0, c1: 0, r2: 6, c2: 0 }, 0, 'desc')
        expect(engine.getCell(6, 0).raw).toBe('')

        const dates = createEngine(5, 1)
        dates.setCells([
            { r: 0, c: 0, value: 'Date' },
            { r: 1, c: 0, value: '2024-03-01' },
            { r: 2, c: 0, value: '2/1/2024' },
            { r: 3, c: 0, value: '15 Jan 2024' }
        ])
        dates.sortRange({ r1: 0, c1: 0, r2: 3, c2: 0 }, 0, 'asc')
        expect(rawColumn(dates, 0, 1, 3)).toEqual(['15 Jan 2024', '2/1/2024', '2024-03-01'])
    })

    it('sorts 10,000 synthetic rows under 300 ms and reports ten Node timings', () => {
        const timings = []
        for (let run = 0; run < 10; run++) {
            const engine = createEngine(10001, 2)
            const entries = [{ r: 0, c: 0, value: 'ID' }, { r: 0, c: 1, value: 'Value' }]
            for (let row = 1; row <= 10000; row++) entries.push({ r: row, c: 0, value: `ID-${row}` }, { r: row, c: 1, value: String(10001 - row) })
            engine.setCells(entries)
            const start = performance.now()
            engine.sortRange({ r1: 0, c1: 0, r2: 10000, c2: 1 }, 1, 'asc')
            timings.push(performance.now() - start)
        }
        const sorted = [...timings].sort((a, b) => a - b)
        const median = (sorted[4] + sorted[5]) / 2
        console.log(`10,000-row sort (Node engine, ms): median=${median.toFixed(2)}, min=${sorted[0].toFixed(2)}, max=${sorted.at(-1).toFixed(2)}`)
        expect(Math.max(...timings)).toBeLessThan(300)
    })

    it('sorts the sales-large date column and reports the engine time', () => {
        const engine = salesEngine(loadSampleLarge)
        const start = performance.now()
        engine.sortRange(engine.getUsedRange(), 1, 'asc')
        const elapsed = performance.now() - start
        console.log(`sales-large date sort (Node engine): ${elapsed.toFixed(2)} ms`)
        expect(engine.getCell(0, 1).raw).toBe('Date')
    })
})

import { describe, expect, it } from 'vitest'
import { createEngine } from './core.js'
import { loadSampleLarge } from '../fixtures/loadSample.js'

describe('scale engine', () => {
  it('fills the sales sample formula down to row 100,000 and reports elapsed time', () => {
    const engine = createEngine(100000, 20)
    loadSampleLarge(engine)
    engine.setCell(1, 10, '=J2*2')
    const start = performance.now()
    engine.fillRange({ r1: 1, c1: 10, r2: 1, c2: 10 }, { r1: 1, c1: 10, r2: 99999, c2: 10 })
    const elapsed = performance.now() - start
    console.log(`sales-large formula fill to row 100,000 (Node engine): ${elapsed.toFixed(2)} ms`)
    expect(engine.getCell(99999, 10).raw).toBe('=J100000*2')
  })

  it('edits J95000 with 50,000 formulas under 16 ms across 20 runs', () => {
    const engine = createEngine(100000, 11)
    const entries = [{ r: 94999, c: 9, value: '10' }]
    for (let row = 50000; row < 100000; row++) entries.push({ r: row, c: 10, value: `=J${row + 1}*2` })
    engine.setCells(entries)
    const timings = []
    for (let run = 0; run < 20; run++) {
      const input = 10 + run
      const start = performance.now()
      engine.setCell(94999, 9, String(input))
      expect(engine.getCell(94999, 10).computed).toBe(input * 2)
      timings.push(performance.now() - start)
    }
    const sorted = [...timings].sort((a, b) => a - b)
    const median = (sorted[9] + sorted[10]) / 2
    console.log(`50,000-formula J95000 dependent edit/read, 20 Node runs (ms): median=${median.toFixed(2)}, min=${sorted[0].toFixed(2)}, max=${sorted.at(-1).toFixed(2)}`)
    expect(median).toBeLessThan(16)
  })
  it('evaluates a 100,000-cell dependency chain without recursion', () => {
    const engine = createEngine(100000, 1)
    const entries = [{ r: 0, c: 0, value: '1' }]
    for (let row = 1; row < 100000; row++) entries.push({ r: row, c: 0, value: `=A${row}+1` })
    engine.setCells(entries)
    expect(engine.getCell(99999, 0).computed).toBe(100000)
  })

  it('recalculates exactly one cell for an unrelated input edit and shifts widths on insert', () => {
    const engine = createEngine(10, 8)
    engine.setCells([{ r: 0, c: 0, value: '1' }, { r: 0, c: 1, value: '=A1+1' }, { r: 3, c: 5, value: 'x' }])
    engine.setCell(3, 5, 'y')
    expect(engine.stats.lastRecalcCount).toBe(1)

    engine.setColWidth(3, 300)
    engine.insertColumn(3)
    expect(engine.getColWidth(3)).toBe(120)
    expect(engine.getColWidth(4)).toBe(300)
    expect(engine.undo()).toBe(true)
    expect(engine.getColWidth(3)).toBe(300)
    engine.insertColumn(3)
    engine.deleteColumn(4)
    expect(engine.getColWidth(3)).toBe(120)

    engine.setRowHeight(4, 40)
    engine.insertRow(4)
    expect(engine.getRowHeight(5)).toBe(40)
    engine.deleteRow(4)
    expect(engine.getRowHeight(4)).toBe(40)
    expect(engine.undo()).toBe(true)
    expect(engine.getRowHeight(5)).toBe(40)
    expect(engine.undo()).toBe(true)
    expect(engine.getRowHeight(4)).toBe(40)
    engine.setFrozen({ rows: 2, cols: 3 })
    expect(engine.getFrozen()).toEqual({ rows: 2, cols: 3 })
    expect(engine.undo()).toBe(true)
    expect(engine.getFrozen()).toEqual({ rows: 1, cols: 1 })
  })

  it('changes the layout version only when sizes or row visibility change', () => {
    const engine = createEngine(5, 2)
    const initialVersion = engine.getLayoutVersion()
    engine.setCell(0, 0, 'Header')
    expect(engine.getLayoutVersion()).toBe(initialVersion)
    engine.setCell(1, 0, 'visible')
    engine.setFilter(0, { values: [] })
    expect(engine.getRowHeight(1)).toBe(0)
    const filteredVersion = engine.getLayoutVersion()
    engine.setColWidth(0, 180)
    expect(engine.getLayoutVersion()).toBeGreaterThan(filteredVersion)
  })
})


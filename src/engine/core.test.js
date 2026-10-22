// Starter tests for the engine. Extend this file (or add more *.test.js
// files) for every behaviour you implement. Graders run `npm test` and add
// their own hidden tests against the public engine API you document in
// DESIGN_NOTES.md.
import { describe, it, expect } from 'vitest'
import { createEngine } from './core.js'

describe('engine basics', () => {
    it('returns the bounding used range, excluding empty cells', () => {
        const engine = createEngine(10, 10)
        expect(engine.getUsedRange()).toEqual({ r1: 0, c1: 0, r2: 0, c2: 0 })
        engine.setCells([{ r: 2, c: 1, value: 'x' }, { r: 5, c: 4, value: '=B3' }])
        expect(engine.getUsedRange()).toEqual({ r1: 2, c1: 1, r2: 5, c2: 4 })
        engine.setCell(5, 4, '')
        expect(engine.getUsedRange()).toEqual({ r1: 2, c1: 1, r2: 2, c2: 1 })
    })

    it('evaluates arithmetic', () => {
        const engine = createEngine(10, 10)
        engine.setCell(0, 0, '10')
        engine.setCell(1, 0, '=A1*2')
        expect(engine.getCell(1, 0).computed).toBe(20)
    })

    it('evaluates a range before applying the rest of the formula', () => {
        const engine = createEngine(10, 10)
        engine.setCell(0, 0, '10')
        engine.setCell(1, 0, '20')
        engine.setCell(2, 0, '=SUM(A1:A2)*2')
        expect(engine.getCell(2, 0).computed).toBe(60)
    })

    it('keeps text that is not a complete plain number unchanged', () => {
        const engine = createEngine(10, 10)
        engine.setCell(0, 0, '2024-01-15')
        engine.setCell(1, 0, '007')
        engine.setCell(2, 0, '10%')
        engine.setCell(3, 0, ' 12.5 ')

        expect(engine.getCell(0, 0).computed).toBe('2024-01-15')
        expect(engine.getCell(1, 0).computed).toBe('007')
        expect(engine.getCell(2, 0).computed).toBe('10%')
        expect(engine.getCell(3, 0).computed).toBe(12.5)

        engine.setCell(0, 1, '=SUM(A1:A3)')
        expect(engine.getCell(0, 1).computed).toBe(0)
    })

    it('parses absolute references in formulas and preserves pinned coordinates on structural edits', () => {
        const engine = createEngine(10, 10)
        engine.setCell(0, 0, '10')
        engine.setCell(1, 0, '20')
        engine.setCell(2, 0, '=SUM($A$1:$A$2)')
        expect(engine.getCell(2, 0).computed).toBe(30)
        engine.setCell(0, 0, '11')
        expect(engine.getCell(2, 0).computed).toBe(31)

        const rowInsertEngine = createEngine(10, 10)
        rowInsertEngine.setCell(4, 1, '=$A$1+$A1+A$1')
        rowInsertEngine.insertRow(0)
        expect(rowInsertEngine.getCell(5, 1).raw).toBe('=$A$2+$A2+A$2')

        const columnInsertEngine = createEngine(10, 10)
        columnInsertEngine.setCell(7, 3, '=$B$1+$B1+B$1')
        columnInsertEngine.insertColumn(1)
        expect(columnInsertEngine.getCell(7, 4).raw).toBe('=$C$1+$C1+C$1')

        const rowDeleteEngine = createEngine(10, 10)
        rowDeleteEngine.setCell(4, 1, '=$A$3+$A3+A$3')
        rowDeleteEngine.deleteRow(1)
        expect(rowDeleteEngine.getCell(3, 1).raw).toBe('=$A$2+$A2+A$2')

        const columnDeleteEngine = createEngine(10, 10)
        columnDeleteEngine.setCell(4, 3, '=$C$1+$C1+C$1')
        columnDeleteEngine.deleteColumn(1)
        expect(columnDeleteEngine.getCell(4, 2).raw).toBe('=$B$1+$B1+B$1')
    })

    it('evaluates unary minus on references and numbers', () => {
        const engine = createEngine(10, 10)
        engine.setCell(0, 0, '5')
        engine.setCell(0, 1, '=-A1')
        engine.setCell(0, 2, '=A1*-1')

        expect(engine.getCell(0, 1).computed).toBe(-5)
        expect(engine.getCell(0, 2).computed).toBe(-5)
    })

    it('fills formulas with relative and absolute references and supports batch undo/redo', () => {
        const engine = createEngine(40, 20)
        engine.setCells([
            { r: 1, c: 10, value: '=G2*H2' },
            { r: 1, c: 11, value: '=$G$2*H2' }
        ])
        engine.fillRange(
            { r1: 1, c1: 10, r2: 1, c2: 11 },
            { r1: 1, c1: 10, r2: 31, c2: 11 }
        )

        expect(engine.getCell(31, 10).raw).toBe('=G32*H32')
        expect(engine.getCell(31, 11).raw).toBe('=$G$2*H32')
        expect(engine.undo()).toBe(true)
        expect(engine.getCell(2, 10).raw).toBe('')
        expect(engine.getCell(31, 10).raw).toBe('')
        expect(engine.redo()).toBe(true)
        expect(engine.getCell(31, 10).raw).toBe('=G32*H32')
        expect(engine.getCell(31, 11).raw).toBe('=$G$2*H32')
    })

    it('recalculates dependent formulas after a batched edit and batch undo/redo', () => {
        const engine = createEngine(10, 10)
        engine.setCells([
            { r: 0, c: 0, value: '1' },
            { r: 0, c: 1, value: '2' },
            { r: 0, c: 2, value: '=A1+B1' }
        ])
        engine.setCells([
            { r: 0, c: 0, value: '3' },
            { r: 0, c: 1, value: '4' }
        ])
        expect(engine.getCell(0, 2).computed).toBe(7)

        engine.undo()
        expect(engine.getCell(0, 2).computed).toBe(3)
        engine.redo()
        expect(engine.getCell(0, 2).computed).toBe(7)
    })

    it('fills horizontally and shifts only relative formula columns', () => {
        const engine = createEngine(10, 10)
        engine.setCell(0, 1, '=$A$1+A$1+$A1')
        engine.fillRange(
            { r1: 0, c1: 1, r2: 0, c2: 1 },
            { r1: 0, c1: 1, r2: 0, c2: 3 }
        )

        expect(engine.getCell(0, 2).raw).toBe('=$A$1+B$1+$A1')
        expect(engine.getCell(0, 3).raw).toBe('=$A$1+C$1+$A1')
    })

    it('fills 5,000 cells in under 200 ms', () => {
        const engine = createEngine(5002, 2)
        engine.setCell(0, 0, '1')
        engine.setCell(1, 0, '2')

        const started = performance.now()
        engine.fillRange(
            { r1: 0, c1: 0, r2: 1, c2: 0 },
            { r1: 0, c1: 0, r2: 5001, c2: 0 }
        )
        const elapsed = performance.now() - started

        expect(engine.getCell(5001, 0).computed).toBe(5002)
        expect(elapsed).toBeLessThan(200)
    })

    it('reports a cycle instead of hanging', () => {
        const engine = createEngine(10, 10)
        engine.setCell(0, 0, '=B1')
        engine.setCell(0, 1, '=A1')
        expect(engine.getCell(0, 1).error).toBe('#CYCLE!')
    })

    it('keeps dependents after editing their precedent and detects a later cycle', () => {
        const engine = createEngine(5, 3)
        engine.setCells([{ r: 0, c: 0, value: '2' }, { r: 0, c: 1, value: '=A1+1' }])
        engine.setCell(0, 0, '4')
        expect(engine.getCell(0, 1).computed).toBe(5)
        engine.setCell(0, 0, '=B1+1')
        expect(engine.getCell(0, 0).error).toBe('#CYCLE!')
        expect(engine.getCell(0, 1).error).toBe('#CYCLE!')
    })

    it('tracks range dependencies without expanding cells and treats blank arithmetic as zero', () => {
        const engine = createEngine(8, 3)
        engine.setCell(0, 1, '=SUM(A1:A5)')
        engine.setCell(2, 0, '7')
        expect(engine.getCell(0, 1).computed).toBe(7)
        engine.setCell(0, 2, '=A8+1')
        expect(engine.getCell(0, 2).computed).toBe(1)
    })

    it('does not recalculate unrelated cells', () => {
        const engine = createEngine(10, 4)
        engine.setCells([{ r: 0, c: 0, value: '1' }, { r: 0, c: 1, value: '=A1+1' }, { r: 2, c: 2, value: '9' }])
        engine.setCell(2, 2, '10')
        expect(engine.stats.lastRecalcCount).toBe(1)
    })

    it('undoes and redoes a single edit', () => {
        const engine = createEngine(10, 10)
        engine.setCell(0, 0, 'hello')
        engine.setCell(0, 0, 'world')
        engine.undo()
        expect(engine.getCell(0, 0).raw).toBe('hello')
        engine.redo()
        expect(engine.getCell(0, 0).raw).toBe('world')
    })

    it('shifts references when a row is inserted above them', () => {
        const engine = createEngine(10, 10)
        engine.setCell(2, 0, '5')       // A3
        engine.setCell(4, 0, '=A3+1')   // A5
        engine.insertRow(1)             // A3 -> A4, A5 -> A6
        expect(engine.getCell(5, 0).raw).toBe('=A4+1')
        expect(engine.getCell(5, 0).computed).toBe(6)
    })
})

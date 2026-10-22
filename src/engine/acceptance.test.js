import { describe, expect, it } from 'vitest'
import { createEngine } from './core.js'
import { loadSampleSmall } from '../fixtures/loadSample.js'

function loadSales() {
    const engine = createEngine(50, 50)
    loadSampleSmall(engine)
    return engine
}

describe('Challenge 1 acceptance on sales.tsv', () => {
    it('fills ORD identifiers and undoes/redoes the fill in one step', () => {
        const engine = loadSales()
        expect(engine.getCell(1, 0).raw).toBe('ORD-1001')
        expect(engine.getCell(2, 0).raw).toBe('ORD-1002')

        // The fixture already contains ORD-1003..1005 here, so replace the
        // destination with distinct prior values to make fill undo observable.
        const previous = ['before-4', 'before-5', 'before-6']
        engine.setCells(previous.map((value, index) => ({ r: index + 3, c: 0, value })))
        engine.fillRange(
            { r1: 1, c1: 0, r2: 2, c2: 0 },
            { r1: 1, c1: 0, r2: 5, c2: 0 }
        )
        expect([3, 4, 5].map(r => engine.getCell(r, 0).raw)).toEqual([
            'ORD-1003', 'ORD-1004', 'ORD-1005'
        ])

        expect(engine.undo()).toBe(true)
        expect([3, 4, 5].map(r => engine.getCell(r, 0).raw)).toEqual(previous)
        expect(engine.redo()).toBe(true)
        expect([3, 4, 5].map(r => engine.getCell(r, 0).raw)).toEqual([
            'ORD-1003', 'ORD-1004', 'ORD-1005'
        ])
    })

    it('fills relative and absolute formulas, then adjusts relative references after row insertion', () => {
        const engine = loadSales()
        engine.setCell(1, 10, '=G2*H2')
        engine.setCell(1, 11, '=$G$2*H2')
        engine.fillRange(
            { r1: 1, c1: 10, r2: 1, c2: 11 },
            { r1: 1, c1: 10, r2: 31, c2: 11 }
        )

        expect(engine.getCell(31, 10).raw).toBe('=G32*H32')
        expect(engine.getCell(31, 11).raw).toBe('=$G$2*H32')

        engine.insertRow(9)
        expect(engine.getCell(32, 11).raw).toBe('=$G$2*H33')
    })

    it('fills mixed date seeds while preserving their date formats', () => {
        const engine = loadSales()
        const seeds = [1, 2, 3].map(r => engine.getCell(r, 1).raw)
        expect(seeds).toEqual(['2024-01-03', '2024-01-05', '1/8/2024'])

        engine.fillRange(
            { r1: 1, c1: 1, r2: 3, c2: 1 },
            { r1: 1, c1: 1, r2: 7, c2: 1 }
        )
        expect([4, 5, 6, 7].map(r => engine.getCell(r, 1).raw)).toEqual([
            '2024-01-11', '2024-01-14', '1/17/2024', '2024-01-20'
        ])
    })

    it('clears a multi-cell range with one setCells call that one undo restores', () => {
        const engine = loadSales()
        const range = []
        for (let r = 1; r <= 3; r++) for (let c = 0; c <= 2; c++) {
            range.push({ r, c, value: engine.getCell(r, c).raw })
        }
        engine.setCells(range.map(({ r, c }) => ({ r, c, value: '' })))
        expect(range.every(({ r, c }) => engine.getCell(r, c).raw === '')).toBe(true)

        expect(engine.undo()).toBe(true)
        expect(range.map(({ r, c }) => engine.getCell(r, c).raw)).toEqual(range.map(({ value }) => value))
    })

    it('fills A2:A3 upward to A1 and one undo restores the header', () => {
        const engine = loadSales()
        expect([1, 2].map(r => engine.getCell(r, 0).raw)).toEqual(['ORD-1001', 'ORD-1002'])

        engine.fillRange(
            { r1: 1, c1: 0, r2: 2, c2: 0 },
            { r1: 0, c1: 0, r2: 2, c2: 0 }
        )
        expect(engine.getCell(0, 0).raw).toBe('ORD-1000')
        expect(engine.undo()).toBe(true)
        expect(engine.getCell(0, 0).raw).toBe('Order ID')
    })

    it('fills a two-cell row seed right and one undo restores the destination', () => {
        const engine = createEngine(5, 5)
        engine.setCells([{ r: 1, c: 0, value: 'ORD-1001' }, { r: 1, c: 1, value: 'ORD-1002' }])

        engine.fillRange(
            { r1: 1, c1: 0, r2: 1, c2: 1 },
            { r1: 1, c1: 0, r2: 1, c2: 3 }
        )
        expect([2, 3].map(c => engine.getCell(1, c).raw)).toEqual(['ORD-1003', 'ORD-1004'])
        expect(engine.undo()).toBe(true)
        expect([2, 3].map(c => engine.getCell(1, c).raw)).toEqual(['', ''])
    })

    it('fills the same two-cell row seed left and one undo restores the destination', () => {
        const engine = createEngine(5, 5)
        engine.setCells([{ r: 1, c: 2, value: 'ORD-1001' }, { r: 1, c: 3, value: 'ORD-1002' }])

        engine.fillRange(
            { r1: 1, c1: 2, r2: 1, c2: 3 },
            { r1: 1, c1: 0, r2: 1, c2: 3 }
        )
        expect([0, 1].map(c => engine.getCell(1, c).raw)).toEqual(['ORD-0999', 'ORD-1000'])
        expect(engine.undo()).toBe(true)
        expect([0, 1].map(c => engine.getCell(1, c).raw)).toEqual(['', ''])
    })
})

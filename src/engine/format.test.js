import { describe, expect, it } from 'vitest'
import { createEngine } from './core.js'

describe('style structural edits', () => {
    it('shifts number formats with inserted and deleted rows and columns, with undo', () => {
        const engine = createEngine(8, 8)
        engine.setCell(1, 1, '12.5')
        engine.setStyle(1, 1, { numberFormat: 'currency' })
        engine.insertRow(1)
        expect(engine.getStyle(2, 1).numberFormat).toBe('currency')
        engine.undo()
        expect(engine.getStyle(1, 1).numberFormat).toBe('currency')
        engine.insertColumn(1)
        expect(engine.getStyle(1, 2).numberFormat).toBe('currency')
        engine.undo()
        expect(engine.getStyle(1, 1).numberFormat).toBe('currency')
        engine.deleteRow(0)
        expect(engine.getStyle(0, 1).numberFormat).toBe('currency')
        engine.undo()
        expect(engine.getStyle(1, 1).numberFormat).toBe('currency')
        engine.deleteColumn(0)
        expect(engine.getStyle(1, 0).numberFormat).toBe('currency')
        engine.undo()
        expect(engine.getStyle(1, 1).numberFormat).toBe('currency')
    })

    it('batches style, frozen-row and width changes into one undo and omits no-op batches', () => {
        const engine=createEngine(8,8)
        engine.batch(()=>{engine.setStyles([{r:0,c:0,style:{numberFormat:'percent'}}],true);engine.setFrozen({rows:2,cols:1});engine.setColWidth(0,180)})
        expect(engine.getStyle(0,0).numberFormat).toBe('percent')
        expect(engine.getFrozen().rows).toBe(2);expect(engine.getColWidth(0)).toBe(180)
        expect(engine.undo()).toBe(true)
        expect(engine.getStyle(0,0)).toEqual({});expect(engine.getFrozen().rows).toBe(1);expect(engine.getColWidth(0)).toBe(120)
        expect(engine.canUndo()).toBe(false)
        engine.batch(()=>{engine.setStyles([{r:0,c:0,style:null}],true);engine.setFrozen({rows:1,cols:1});engine.setColWidth(0,120)})
        expect(engine.canUndo()).toBe(false)
    })
})

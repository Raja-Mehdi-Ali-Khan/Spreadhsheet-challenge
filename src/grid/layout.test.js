import { describe, expect, it } from 'vitest'
import { buildOffsets, indexAtOffset, sameRange, visibleRange } from './layout.js'

describe('virtual grid layout', () => {
  it('builds cumulative offsets and maps boundaries with binary search', () => {
    const offsets = buildOffsets([10, 20, 15])
    expect([...offsets]).toEqual([0, 10, 30, 45])
    expect(indexAtOffset(offsets, 0)).toBe(0)
    expect(indexAtOffset(offsets, 10)).toBe(1)
    expect(indexAtOffset(offsets, 44)).toBe(2)
  })

  it('skips hidden zero-height rows and includes overscan', () => {
    const rows = buildOffsets([20, 0, 20, 20, 20])
    const columns = buildOffsets([50, 100, 80, 90])
    expect(indexAtOffset(rows, 20)).toBe(2)
    expect(visibleRange({ rowOffsets: rows, columnOffsets: columns, scrollTop: 20, scrollLeft: 50, viewportHeight: 21, viewportWidth: 81, overscan: 1 }))
      .toEqual({ r1: 1, r2: 4, c1: 0, c2: 2 })
  })

  it('reflects resized and structurally shifted size arrays in rebuilt offsets', () => {
    const widths = [120, 300, 120]
    expect([...buildOffsets(widths)]).toEqual([0, 120, 420, 540])
    widths.splice(1, 0, 120)
    expect([...buildOffsets(widths)]).toEqual([0, 120, 240, 540, 660])
    widths.splice(2, 1)
    expect([...buildOffsets(widths)]).toEqual([0, 120, 240, 360])
    expect(sameRange({ r1: 1, r2: 3, c1: 0, c2: 2 }, { r1: 1, r2: 3, c1: 0, c2: 2 })).toBe(true)
  })
})

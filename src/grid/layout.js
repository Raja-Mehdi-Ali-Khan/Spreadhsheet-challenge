export function buildOffsets(sizes) {
  const offsets = new Float64Array(sizes.length + 1)
  for (let index = 0; index < sizes.length; index++) offsets[index + 1] = offsets[index] + Math.max(0, sizes[index])
  return offsets
}

export function indexAtOffset(offsets, offset) {
  if (offsets.length <= 1) return 0
  const target = Math.max(0, Math.min(offset, offsets[offsets.length - 1]))
  let low = 0, high = offsets.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (offsets[middle + 1] <= target) low = middle + 1
    else high = middle
  }
  return Math.min(low, offsets.length - 2)
}

export function visibleRange({ rowOffsets, columnOffsets, scrollTop, scrollLeft, viewportHeight, viewportWidth, overscan = 3 }) {
  const rowCount = rowOffsets.length - 1
  const columnCount = columnOffsets.length - 1
  const firstRow = indexAtOffset(rowOffsets, scrollTop)
  const lastRow = indexAtOffset(rowOffsets, scrollTop + Math.max(0, viewportHeight - 1))
  const firstColumn = indexAtOffset(columnOffsets, scrollLeft)
  const lastColumn = indexAtOffset(columnOffsets, scrollLeft + Math.max(0, viewportWidth - 1))
  return {
    r1: Math.max(0, firstRow - overscan),
    r2: Math.min(rowCount - 1, lastRow + overscan),
    c1: Math.max(0, firstColumn - overscan),
    c2: Math.min(columnCount - 1, lastColumn + overscan)
  }
}

export function sameRange(a, b) {
  return a.r1 === b.r1 && a.r2 === b.r2 && a.c1 === b.c1 && a.c2 === b.c2
}

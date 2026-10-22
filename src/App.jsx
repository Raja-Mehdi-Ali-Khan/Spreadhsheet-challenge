import { Profiler, memo, useState, useRef, useCallback, useMemo, useEffect } from 'react'
import './App.css'
import { createEngine } from './engine/core.js'
import { loadSampleSmall, loadSampleLarge } from './fixtures/loadSample.js'
import { buildOffsets, sameRange, visibleRange as calculateVisibleRange } from './grid/layout.js'
import AiPanel from './AiPanel.jsx'
import { formatDisplay } from './format/display.js'

const TOTAL_ROWS = 100000
const TOTAL_COLS = 200
const HEADER_HEIGHT = 30
const ROW_HEADER_WIDTH = 50
const DEFAULT_STYLE = { bold: false, italic: false, underline: false, bg: 'white', color: '#202124', align: 'left', fontSize: 13, numberFormat: 'general' }
const filterValueKey = value => String(value ?? '').trim() ? String(value).trim().toLocaleLowerCase() : '(blanks)'
const VirtualCell = memo(function VirtualCell({ r, c, raw, computed, error, bold, italic, underline, color, fontSize, align, bg, numberFormat, selected, isAnchor, topEdge, bottomEdge, leftEdge, rightEdge, editing, editValue, inputRef, onInputChange, onInputKeyDown, onInputBlur, top, left, width, height, frozenRow, frozenCol, showFillHandle, onFillStart }) {
  const value = error || ((computed !== null && computed !== '') ? computed : raw)
  const display = error || formatDisplay(value, numberFormat)
  return <div data-cell data-r={r} data-c={c} data-frozen-row={frozenRow ? "true" : undefined} data-frozen-col={frozenCol ? "true" : undefined} className={`virtual-cell ${selected ? 'in-selection' : ''} ${isAnchor ? 'anchor-cell' : ''} ${topEdge ? 'selection-top' : ''} ${bottomEdge ? 'selection-bottom' : ''} ${leftEdge ? 'selection-left' : ''} ${rightEdge ? 'selection-right' : ''}`} style={{ top, left, width, height, background: bg }}>
    {editing ? <input ref={inputRef} className="cell-input" value={editValue} onChange={onInputChange} onKeyDown={onInputKeyDown} onBlur={onInputBlur} style={{ fontWeight: bold ? 'bold' : 'normal', fontStyle: italic ? 'italic' : 'normal', textDecoration: underline ? 'underline' : 'none', color, fontSize: fontSize + 'px', textAlign: align, background: bg }}/> : <div className={`cell-display align-${align} ${error ? 'error' : ''}`} style={{ fontWeight: bold ? 'bold' : 'normal', fontStyle: italic ? 'italic' : 'normal', textDecoration: underline ? 'underline' : 'none', color: error ? '#d93025' : color, fontSize: fontSize + 'px' }}>{display}</div>}
    {showFillHandle && <button aria-label="Fill handle" className="fill-handle" onPointerDown={onFillStart}/>}
  </div>
})

export default function App() {
  const [engine] = useState(() => createEngine(TOTAL_ROWS, TOTAL_COLS))
  const [, setVersion] = useState(0)
  const [selection, setSelection] = useState({ anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 } })
  const [editingCell, setEditingCell] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [fillPreview, setFillPreview] = useState(null)
  const [openFilterColumn, setOpenFilterColumn] = useState(null)
  const [filterOptions, setFilterOptions] = useState([])
  const [filterDraft, setFilterDraft] = useState({ search: '', selected: [], conditionOp: '', conditionValue: '' })
  const [sortIndicator, setSortIndicator] = useState(null)
  const [layoutRevision, setLayoutRevision] = useState(0)
  const [visibleCells, setVisibleCells] = useState({ r1: 0, r2: 30, c1: 0, c2: 10 })
  const [nameValue, setNameValue] = useState('A1')
  const [perfView, setPerfView] = useState({ commits: 0, duration: 0, scrollFrame: 0 })
  const [resizePreview, setResizePreview] = useState(null)
  const [aiOpen, setAiOpen] = useState(false)
  const gridRef = useRef(null)
  const inputRef = useRef(null)
  const filterDropdownRef = useRef(null)
  const mouseSelecting = useRef(false)
  const fillDrag = useRef(null)
  const fillAutoFrame = useRef(0)
  const fillPointer = useRef(null)
  const scrollFrame = useRef(0)
  const scrollStartedAt = useRef(0)
  const lastScrollFrame = useRef(0)
  const profileStats = useRef({ commits: 0, duration: 0 })
  const perfEnabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('perf') === '1'
  const sizeLayoutVersion = engine.getLayoutVersion()
  const rowOffsets = useMemo(() => { void sizeLayoutVersion; return buildOffsets(Array.from({ length: engine.rows }, (_, row) => engine.getRowHeight(row))) }, [engine, sizeLayoutVersion])
  const columnOffsets = useMemo(() => { void sizeLayoutVersion; return buildOffsets(Array.from({ length: engine.cols }, (_, col) => engine.getColWidth(col))) }, [engine, sizeLayoutVersion])
  const frozen = engine.getFrozen()
  const totalGridWidth = ROW_HEADER_WIDTH + columnOffsets[columnOffsets.length - 1]
  const totalGridHeight = HEADER_HEIGHT + rowOffsets[rowOffsets.length - 1]
  const force = useCallback(() => setVersion(v => v + 1), [])
  const anchor = selection.anchor
  const styleAt = useCallback((r, c) => ({ ...DEFAULT_STYLE, ...engine.getStyle(r, c) }), [engine])
  const bounds = useMemo(() => ({ r1: Math.min(selection.anchor.r, selection.focus.r), c1: Math.min(selection.anchor.c, selection.focus.c), r2: Math.max(selection.anchor.r, selection.focus.r), c2: Math.max(selection.anchor.c, selection.focus.c) }), [selection])
  const activeBounds = fillPreview || bounds
  const getColumnLabel = useCallback((col) => { let label = ''; for (let n = col + 1; n; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + ((n - 1) % 26)) + label; return label }, [])
  const label = `${getColumnLabel(anchor.c)}${anchor.r + 1}`
  const usedRange = engine.getUsedRange()
  const totalsRow = ['total', 'totals', 'grand total'].includes(engine.getCell(usedRange.r2, 0).raw.trim().toLocaleLowerCase())
  const totalDataRows = Math.max(0, usedRange.r2 - (totalsRow ? 1 : 0))

  const syncFrozenLayers = useCallback(() => {
    const grid = gridRef.current
    if (!grid) return
    const { scrollTop, scrollLeft } = grid
    grid.querySelectorAll('[data-frozen-row="true"], [data-frozen-col="true"]').forEach(element => {
      const x = element.dataset.frozenCol === 'true' ? scrollLeft : 0
      const y = element.dataset.frozenRow === 'true' ? scrollTop : 0
      element.style.transform = `translate(${x}px, ${y}px)`
    })
  }, [])
  const updateVisibleRange = useCallback(() => {
    const grid = gridRef.current
    if (!grid) return
    const range = calculateVisibleRange({ rowOffsets, columnOffsets, scrollTop: grid.scrollTop, scrollLeft: grid.scrollLeft, viewportHeight: grid.clientHeight - HEADER_HEIGHT, viewportWidth: grid.clientWidth - ROW_HEADER_WIDTH, overscan: 4 })
    setVisibleCells(previous => sameRange(previous, range) ? previous : range)
    syncFrozenLayers()
    if (scrollStartedAt.current) lastScrollFrame.current = performance.now() - scrollStartedAt.current
  }, [rowOffsets, columnOffsets, syncFrozenLayers])
  useEffect(() => {
    updateVisibleRange()
    const onResize = () => updateVisibleRange()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [updateVisibleRange, layoutRevision])
  useEffect(() => () => { if (scrollFrame.current) cancelAnimationFrame(scrollFrame.current) }, [])
  useEffect(() => { syncFrozenLayers() })
  useEffect(() => {
    const row = Math.max(0, Math.min(engine.rows - 1, selection.focus.r))
    const col = Math.max(0, Math.min(engine.cols - 1, selection.focus.c))
    const grid = gridRef.current
    if (!grid) return
    const top = HEADER_HEIGHT + rowOffsets[row], bottom = HEADER_HEIGHT + rowOffsets[row + 1]
    const left = ROW_HEADER_WIDTH + columnOffsets[col], right = ROW_HEADER_WIDTH + columnOffsets[col + 1]
    if (top < grid.scrollTop + HEADER_HEIGHT) grid.scrollTop = Math.max(0, top - HEADER_HEIGHT)
    else if (bottom > grid.scrollTop + grid.clientHeight) grid.scrollTop = bottom - grid.clientHeight
    if (left < grid.scrollLeft + ROW_HEADER_WIDTH) grid.scrollLeft = Math.max(0, left - ROW_HEADER_WIDTH)
    else if (right > grid.scrollLeft + grid.clientWidth) grid.scrollLeft = right - grid.clientWidth
    updateVisibleRange()
  }, [selection.focus.r, selection.focus.c, engine, rowOffsets, columnOffsets, updateVisibleRange])
  useEffect(() => {
    if (!perfEnabled) return undefined
    const timer = window.setInterval(() => setPerfView({ commits: profileStats.current.commits, duration: profileStats.current.duration, scrollFrame: lastScrollFrame.current }), 500)
    return () => window.clearInterval(timer)
  }, [perfEnabled])
  const onProfileRender = useCallback((_id, _phase, actualDuration) => {
    profileStats.current.commits++
    profileStats.current.duration = actualDuration
  }, [])

  useEffect(() => {
    if (openFilterColumn === null) return undefined
    const closeOutside = event => {
      if (!filterDropdownRef.current?.contains(event.target)) setOpenFilterColumn(null)
    }
    const closeOnEscape = event => {
      if (event.key === 'Escape') { setOpenFilterColumn(null); event.stopPropagation() }
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [openFilterColumn])
  useEffect(() => {
    const handleAiShortcut = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setAiOpen(open => !open)
      }
    }
    window.addEventListener('keydown', handleAiShortcut)
    return () => window.removeEventListener('keydown', handleAiShortcut)
  }, [])
  const setFocus = useCallback((r, c, extend = false) => {
    setSelection(prev => ({ anchor: extend ? prev.anchor : { r, c }, focus: { r, c } }))
    if (!extend) setNameValue(`${getColumnLabel(c)}${r + 1}`)
  }, [getColumnLabel])
  const commitEdit = useCallback((move = null) => {
    if (!editingCell) return
    const { r, c } = editingCell
    if (engine.getCell(r, c).raw !== editValue) { engine.setCell(r, c, editValue); force() }
    setEditingCell(null)
    if (move) setFocus(Math.max(0, Math.min(engine.rows - 1, r + move.r)), Math.max(0, Math.min(engine.cols - 1, c + move.c)))
  }, [editingCell, editValue, engine, force, setFocus])
  const beginEdit = useCallback((r, c, value) => {
    setSelection({ anchor: { r, c }, focus: { r, c } })
    setNameValue(`${getColumnLabel(c)}${r + 1}`)
    setEditingCell({ r, c })
    setEditValue(value === undefined ? engine.getCell(r, c).raw : value)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [engine, getColumnLabel])
  const selectCell = useCallback((r, c, shift = false) => {
    if (editingCell) commitEdit()
    setFocus(r, c, shift)
    gridRef.current?.focus()
  }, [editingCell, commitEdit, setFocus])

  const applyStyle = useCallback((updates) => {
    const entries = []
    for (let r = bounds.r1; r <= bounds.r2; r++) for (let c = bounds.c1; c <= bounds.c2; c++) entries.push({ r, c, style: updates })
    engine.setStyles(entries)
    force()
  }, [bounds, engine, force])
  const toggleStyle = useCallback((name) => applyStyle({ [name]: !styleAt(anchor.r, anchor.c)[name] }), [applyStyle, styleAt, anchor])
  const clearSelection = useCallback(() => {
    const changes = []
    for (let r = bounds.r1; r <= bounds.r2; r++) for (let c = bounds.c1; c <= bounds.c2; c++) changes.push({ r, c, value: '' })
    engine.setCells(changes)
    force()
    setEditingCell(null)
    setEditValue('')
  }, [bounds, engine, force])

  const navigateKey = useCallback((event) => {
    if (event.key === 'Escape') { setEditValue(engine.getCell(anchor.r, anchor.c).raw); setEditingCell(null); return }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (engine.undo()) { setLayoutRevision(value => value + 1); force() }; return }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); if (engine.redo()) { setLayoutRevision(value => value + 1); force() }; return }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Home') { event.preventDefault(); setFocus(0, 0); return }
    if ((event.ctrlKey || event.metaKey) && event.key === 'End') { event.preventDefault(); const used = engine.getUsedRange(); setFocus(used.r2, used.c2); return }
    if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); beginEdit(anchor.r, anchor.c); return }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); clearSelection(); return }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      const used = engine.getUsedRange()
      setSelection({ anchor: { r: used.r1, c: used.c1 }, focus: { r: used.r2, c: used.c2 } }); setNameValue(`${getColumnLabel(used.c1)}${used.r1 + 1}`); return
    }
    const delta = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key]
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault()
      const grid = gridRef.current
      const amount = grid ? Math.max(1, visibleCells.r2 - visibleCells.r1 + 1 - 8) : 20
      const step = event.key === 'PageUp' ? -amount : amount
      let row = Math.max(0, Math.min(engine.rows - 1, selection.focus.r + step))
      while (row !== selection.focus.r && engine.isRowHidden(row)) row = Math.max(0, Math.min(engine.rows - 1, row + Math.sign(step)))
      setFocus(row, selection.focus.c)
      return
    }
    if (delta) {
      event.preventDefault()
      let nextRow = Math.max(0, Math.min(engine.rows - 1, selection.focus.r + delta[0]))
      if (delta[0] !== 0) {
        while (nextRow !== selection.focus.r && engine.isRowHidden(nextRow)) {
          const advancedRow = Math.max(0, Math.min(engine.rows - 1, nextRow + delta[0]))
          if (advancedRow === nextRow) { nextRow = selection.focus.r; break }
          nextRow = advancedRow
        }
      }
      setFocus(nextRow, Math.max(0, Math.min(engine.cols - 1, selection.focus.c + delta[1])), event.shiftKey)
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      setFocus(selection.focus.r, Math.max(0, Math.min(engine.cols - 1, selection.focus.c + (event.shiftKey ? -1 : 1))))
      return
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) beginEdit(anchor.r, anchor.c, event.key)
  }, [engine, anchor, selection, beginEdit, clearSelection, setFocus, force, getColumnLabel, visibleCells])

  const onGridKeyDown = useCallback((event) => { if (!editingCell) navigateKey(event) }, [editingCell, navigateKey])
  const onInputKeyDown = useCallback((event) => {
    if (event.key === 'Escape') { event.preventDefault(); setEditValue(engine.getCell(editingCell.r, editingCell.c).raw); setEditingCell(null); gridRef.current?.focus() }
    else if (event.key === 'Enter') { event.preventDefault(); commitEdit({ r: 1, c: 0 }); gridRef.current?.focus() }
    else if (event.key === 'Tab') { event.preventDefault(); commitEdit({ r: 0, c: 1 }); gridRef.current?.focus() }
  }, [engine, editingCell, commitEdit])

  const selectWholeColumn = useCallback((column) => {
    if (editingCell) commitEdit()
    setSelection({ anchor: { r: 0, c: column }, focus: { r: engine.rows - 1, c: column } })
    setNameValue(`${getColumnLabel(column)}1`)
    gridRef.current?.focus()
  }, [editingCell, commitEdit, engine, getColumnLabel])
  const selectWholeRow = useCallback((row) => {
    if (editingCell) commitEdit()
    setSelection({ anchor: { r: row, c: 0 }, focus: { r: row, c: engine.cols - 1 } })
    setNameValue(`A${row + 1}`)
    gridRef.current?.focus()
  }, [editingCell, commitEdit, engine])
  const openColumnFilter = useCallback((column) => {
    if (openFilterColumn === column) { setOpenFilterColumn(null); return }
    const options = engine.getDistinctValues(column)
    setFilterOptions(options)
    const current = engine.getFilter(column)
    setFilterDraft({
      search: '',
      selected: current?.values ? [...current.values] : options.map(filterValueKey),
      conditionOp: current?.condition?.op || '',
      conditionValue: current?.condition?.value || ''
    })
    setOpenFilterColumn(column)
  }, [engine, openFilterColumn])
  const applyColumnFilter = useCallback(() => {
    if (openFilterColumn === null) return
    const filter = { values: filterDraft.selected }
    if (filterDraft.conditionOp) filter.condition = { op: filterDraft.conditionOp, value: filterDraft.conditionValue }
    engine.setFilter(openFilterColumn, filter)
    setOpenFilterColumn(null)
    setLayoutRevision(value => value + 1)
    force()
  }, [engine, openFilterColumn, filterDraft, force])
  const clearColumnFilter = useCallback(() => {
    if (openFilterColumn === null) return
    engine.setFilter(openFilterColumn, null)
    setOpenFilterColumn(null)
    setLayoutRevision(value => value + 1)
    force()
  }, [engine, openFilterColumn, force])
  const clearAllFilters = useCallback(() => { engine.clearFilters(); setOpenFilterColumn(null); setLayoutRevision(value => value + 1); force() }, [engine, force])
  const sortColumn = useCallback((column) => {
    if (editingCell) commitEdit()
    const cycle = ['asc', 'desc', 'original']
    const direction = sortIndicator?.column === column ? cycle[(cycle.indexOf(sortIndicator.direction) + 1) % cycle.length] : 'asc'
    const multiCellSelection = bounds.r1 !== bounds.r2 || bounds.c1 !== bounds.c2
    const used = engine.getUsedRange()
    const block = multiCellSelection ? bounds : { r1: 0, c1: 0, r2: used.r2, c2: used.c2 }
    engine.sortRange(block, column, direction)
    setLayoutRevision(value => value + 1)
    setSortIndicator({ column, direction })
    force()
  }, [editingCell, commitEdit, sortIndicator, bounds, engine, force])

  const submitNameBox = useCallback(() => {
    const match = nameValue.trim().toUpperCase().match(/^([A-Z]+)(\d+)$/)
    if (!match) { setNameValue(label); return }
    let col = 0
    for (const letter of match[1]) col = col * 26 + letter.charCodeAt(0) - 64
    const row = Number(match[2]) - 1
    col--
    if (row < 0 || row >= engine.rows || col < 0 || col >= engine.cols) { setNameValue(label); return }
    if (editingCell) commitEdit()
    setFocus(row, col)
    setNameValue(`${getColumnLabel(col)}${row + 1}`)
    gridRef.current?.focus()
  }, [nameValue, label, engine, editingCell, commitEdit, setFocus, getColumnLabel])

  const startColumnResize = useCallback((event, column) => {
    event.preventDefault(); event.stopPropagation()
    const startX = event.clientX, initial = engine.getColWidth(column)
    let width = initial
    const move = moveEvent => { width = Math.max(24, initial + moveEvent.clientX - startX); setResizePreview({ axis: 'column', value: width }) }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      setResizePreview(null)
      if (width !== initial) { engine.setColWidth(column, width); setLayoutRevision(value => value + 1); force() }
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true })
  }, [engine, force])

  const autoFitColumn = useCallback((column) => {
    const used = engine.getUsedRange()
    let longest = 0
    for (let row = used.r1; row <= used.r2; row++) {
      const cell = engine.getCell(row, column)
      const value = cell.error || String(cell.computed ?? cell.raw ?? '')
      longest = Math.max(longest, value.length)
    }
    engine.setColWidth(column, Math.max(48, Math.min(400, longest * 7.5 + 24)))
    setLayoutRevision(value => value + 1); force()
  }, [engine, force])

  const startRowResize = useCallback((event, row) => {
    event.preventDefault(); event.stopPropagation()
    const startY = event.clientY, initial = Math.max(12, engine.getRowHeight(row))
    let height = initial
    const move = moveEvent => { height = Math.max(12, initial + moveEvent.clientY - startY); setResizePreview({ axis: 'row', value: height }) }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      setResizePreview(null)
      if (height !== initial) { engine.setRowHeight(row, height); setLayoutRevision(value => value + 1); force() }
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true })
  }, [engine, force])

  const updateFillPreview = useCallback((clientX, clientY) => {
    const target = document.elementFromPoint(clientX, clientY)?.closest('[data-cell]')
    if (!target || !fillDrag.current) return
    const r = Number(target.dataset.r), c = Number(target.dataset.c), src = fillDrag.current.src
    const dr = r - src.r2, dc = c - src.c2
    const next = Math.abs(dr) >= Math.abs(dc)
      ? { r1: Math.min(src.r1, r), c1: src.c1, r2: Math.max(src.r2, r), c2: src.c2 }
      : { r1: src.r1, c1: Math.min(src.c1, c), r2: src.r2, c2: Math.max(src.c2, c) }
    if (next.r1 !== fillDrag.current.preview.r1 || next.c1 !== fillDrag.current.preview.c1 || next.r2 !== fillDrag.current.preview.r2 || next.c2 !== fillDrag.current.preview.c2) {
      fillDrag.current.preview = next
      setFillPreview(next)
    }
  }, [])
  const autoScrollFill = useCallback(function autoScrollFillFrame() {
    fillAutoFrame.current = 0
    const grid = gridRef.current, pointer = fillPointer.current
    if (!grid || !pointer || !fillDrag.current) return
    const rect = grid.getBoundingClientRect()
    let moved = false
    if (pointer.clientY >= rect.bottom - 24 && grid.scrollTop < grid.scrollHeight - grid.clientHeight) { grid.scrollTop += 20; moved = true }
    else if (pointer.clientY <= rect.top + 24 && grid.scrollTop > 0) { grid.scrollTop -= 20; moved = true }
    if (pointer.clientX >= rect.right - 24 && grid.scrollLeft < grid.scrollWidth - grid.clientWidth) { grid.scrollLeft += 20; moved = true }
    else if (pointer.clientX <= rect.left + 24 && grid.scrollLeft > 0) { grid.scrollLeft -= 20; moved = true }
    if (!moved) return
    updateFillPreview(pointer.clientX, pointer.clientY)
    fillAutoFrame.current = requestAnimationFrame(autoScrollFillFrame)
  }, [updateFillPreview])
  const handleFillMove = useCallback((event) => {
    fillPointer.current = { clientX: event.clientX, clientY: event.clientY }
    updateFillPreview(event.clientX, event.clientY)
    const grid = gridRef.current
    if (!grid || fillAutoFrame.current) return
    const rect = grid.getBoundingClientRect()
    const nearEdge = event.clientY >= rect.bottom - 24 || event.clientY <= rect.top + 24 || event.clientX >= rect.right - 24 || event.clientX <= rect.left + 24
    if (nearEdge) fillAutoFrame.current = requestAnimationFrame(() => { fillAutoFrame.current = 0; autoScrollFill() })
  }, [updateFillPreview, autoScrollFill])
  const endFill = useCallback(() => {
    if (!fillDrag.current) return
    const { src, preview } = fillDrag.current
    if (preview.r1 !== src.r1 || preview.c1 !== src.c1 || preview.r2 !== src.r2 || preview.c2 !== src.c2) {
      engine.fillRange(src, preview)
      force()
      setSelection({ anchor: { r: preview.r1, c: preview.c1 }, focus: { r: preview.r2, c: preview.c2 } })
      setNameValue(`${getColumnLabel(preview.c1)}${preview.r1 + 1}`)
    }
    fillDrag.current = null; setFillPreview(null)
    fillPointer.current = null
    if (fillAutoFrame.current) cancelAnimationFrame(fillAutoFrame.current)
    fillAutoFrame.current = 0
    window.removeEventListener('pointermove', handleFillMove)
  }, [engine, force, handleFillMove, getColumnLabel])

  const load = (loader) => { engine.clearFilters(); setOpenFilterColumn(null); setSortIndicator(null); loader(engine); force(); setLayoutRevision(value => value + 1); setSelection({ anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 } }); setNameValue('A1'); setEditingCell(null) }
  const undo = () => { if (engine.undo()) { setLayoutRevision(value => value + 1); force() } }
  const redo = () => { if (engine.redo()) { setLayoutRevision(value => value + 1); force() } }
  const rangeContains = (r, c) => r >= activeBounds.r1 && r <= activeBounds.r2 && c >= activeBounds.c1 && c <= activeBounds.c2

  const visibleRowIndices = [...new Set([...Array.from({ length: Math.max(0, visibleCells.r2 - visibleCells.r1 + 1) }, (_, index) => visibleCells.r1 + index), ...Array.from({ length: frozen.rows }, (_, index) => index)])].filter(row => row >= 0 && row < engine.rows && engine.getRowHeight(row) > 0)
  const visibleColumnIndices = [...new Set([...Array.from({ length: Math.max(0, visibleCells.c2 - visibleCells.c1 + 1) }, (_, index) => visibleCells.c1 + index), ...Array.from({ length: frozen.cols }, (_, index) => index)])].filter(column => column >= 0 && column < engine.cols)
  const gridContent = <div className="main-content">
    <div className="toolbar">
      <button className="toolbar-btn bold-btn" onClick={() => toggleStyle('bold')}>B</button><button className="toolbar-btn italic-btn" onClick={() => toggleStyle('italic')}>I</button><button className="toolbar-btn underline-btn" onClick={() => toggleStyle('underline')}>U</button>
      <select className="toolbar-select" aria-label="Font size" onChange={e => applyStyle({ fontSize: Number(e.target.value) })} defaultValue="13">{[8,10,11,12,13,14,16,18,20,24].map(n => <option key={n}>{n}</option>)}</select>
      {['left','center','right'].map(a => <button key={a} className="align-btn" onClick={() => applyStyle({ align: a })}>{a}</button>)}
      <input type="color" aria-label="Text color" onChange={e => applyStyle({ color: e.target.value })}/>
      <select className="toolbar-select" aria-label="Fill color" onChange={e => applyStyle({ bg: e.target.value })}><option value="white">White</option><option value="#ffff99">Yellow</option><option value="#99ffcc">Green</option><option value="#ffcccc">Red</option><option value="#cce5ff">Blue</option></select>
      <button className="toolbar-btn" onClick={undo} disabled={!engine.canUndo()}>↶ Undo</button><button className="toolbar-btn" onClick={redo} disabled={!engine.canRedo()}>↷ Redo</button>
      <button className="toolbar-btn" onClick={() => { engine.insertRow(anchor.r); force(); setLayoutRevision(value => value + 1) }}>+ Row</button><button className="toolbar-btn" onClick={() => { engine.deleteRow(anchor.r); force(); setLayoutRevision(value => value + 1) }}>- Row</button><button className="toolbar-btn" onClick={() => { engine.insertColumn(anchor.c); force(); setLayoutRevision(value => value + 1) }}>+ Col</button><button className="toolbar-btn" onClick={() => { engine.deleteColumn(anchor.c); force(); setLayoutRevision(value => value + 1) }}>- Col</button>
      <button className="toolbar-btn" onClick={() => { engine.setFrozen({ rows: frozen.rows ? 0 : 1, cols: frozen.cols }); force() }}>{frozen.rows ? "Unfreeze top row" : "Freeze top row"}</button>
      <button className="toolbar-btn" onClick={() => setAiOpen(true)}>Ask your data (Ctrl+K)</button>
      {engine.hasActiveFilters() && <button className="toolbar-btn" onClick={clearAllFilters}>Clear all filters</button>}
      <button className="toolbar-btn danger" onClick={clearSelection}>✕ Clear</button><button className="toolbar-btn" onClick={() => load(loadSampleSmall)}>⬇ Sample 33</button><button className="toolbar-btn" onClick={() => load(loadSampleLarge)}>⬇ Sample 3k</button>
    </div>
    <div className="formula-bar"><input className="formula-bar-label name-box" aria-label="Cell name" value={nameValue} onChange={event => setNameValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); submitNameBox() } }}/><input className="formula-bar-input" value={editingCell ? editValue : engine.getCell(anchor.r, anchor.c).raw} onFocus={() => { if (!editingCell) { setEditingCell(anchor); setEditValue(engine.getCell(anchor.r, anchor.c).raw) } }} onChange={e => setEditValue(e.target.value)} onKeyDown={onInputKeyDown} onBlur={() => { if (editingCell) commitEdit() }}/></div>
    <div className="grid-scroll" ref={gridRef} tabIndex={0} onKeyDown={onGridKeyDown}
      onScroll={() => { if (!scrollFrame.current) { scrollStartedAt.current = performance.now(); scrollFrame.current = requestAnimationFrame(() => { scrollFrame.current = 0; updateVisibleRange() }) } }}
      onPointerDown={event => { if (event.target.closest('.fill-handle')) return; const cell = event.target.closest('[data-cell]'); if (!cell) return; const r = Number(cell.dataset.r), c = Number(cell.dataset.c); if (editingCell?.r === r && editingCell?.c === c) return; event.preventDefault(); selectCell(r, c, event.shiftKey); mouseSelecting.current = true; window.addEventListener('pointerup', () => { mouseSelecting.current = false }, { once: true }) }}
      onDoubleClick={event => { const cell = event.target.closest('[data-cell]'); if (cell) beginEdit(Number(cell.dataset.r), Number(cell.dataset.c)) }}      onPointerMove={event => {
        if (!mouseSelecting.current) return
        const el = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-cell]')
        if (!el) return
        const r = Number(el.dataset.r), c = Number(el.dataset.c)
        setSelection(prev => prev.focus.r === r && prev.focus.c === c ? prev : { anchor: prev.anchor, focus: { r, c } })
      }}>
      <div className="grid-sizer" style={{ width: totalGridWidth, height: totalGridHeight }}>
        <div className="virtual-corner" data-frozen-row="true" data-frozen-col="true" style={{ width: ROW_HEADER_WIDTH, height: HEADER_HEIGHT }}/>
        {visibleColumnIndices.map(c => {
          const activeFilter = engine.getFilter(c), sortDirection = sortIndicator?.column === c ? sortIndicator.direction : null
          return <div key={`h${c}`} className="virtual-column-header" data-frozen-row="true" data-frozen-col={c < frozen.cols ? 'true' : undefined} style={{ left: ROW_HEADER_WIDTH + columnOffsets[c], width: columnOffsets[c + 1] - columnOffsets[c], height: HEADER_HEIGHT }}>
            <span className="col-header-label" onClick={() => selectWholeColumn(c)}>{getColumnLabel(c)}</span>
            <span className="header-controls"><button type="button" className="header-control" aria-label={`Sort ${getColumnLabel(c)}`} onClick={() => sortColumn(c)}>{sortDirection === 'asc' ? '↑' : sortDirection === 'desc' ? '↓' : sortDirection === 'original' ? '↕' : '⇅'}</button><button type="button" className={`header-control ${activeFilter ? 'filter-active' : ''}`} aria-label={`Filter ${getColumnLabel(c)}`} onClick={() => openColumnFilter(c)}>▾</button></span>
            {openFilterColumn === c && <div className="filter-dropdown" ref={filterDropdownRef} onPointerDown={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpenFilterColumn(null) } }}>
              <input className="filter-search" aria-label="Search values" placeholder="Search values" value={filterDraft.search} onChange={event => setFilterDraft(draft => ({ ...draft, search: event.target.value }))}/>
              <div className="filter-values">{filterOptions.filter(value => value.toLocaleLowerCase().includes(filterDraft.search.trim().toLocaleLowerCase())).map(value => { const key = filterValueKey(value), checked = filterDraft.selected.includes(key); return <label key={key} className="filter-option"><input type="checkbox" checked={checked} onChange={() => setFilterDraft(draft => ({ ...draft, selected: checked ? draft.selected.filter(item => item !== key) : [...draft.selected, key] }))}/>{value}</label> })}</div>
              <label className="filter-condition-label">Condition<select value={filterDraft.conditionOp} onChange={event => setFilterDraft(draft => ({ ...draft, conditionOp: event.target.value }))}><option value="">None</option><option value="contains">Contains</option><option value="gt">Greater than</option><option value="lt">Less than</option><option value="empty">Is empty</option></select></label>
              {filterDraft.conditionOp && filterDraft.conditionOp !== 'empty' && <input className="filter-search" aria-label="Condition value" value={filterDraft.conditionValue} onChange={event => setFilterDraft(draft => ({ ...draft, conditionValue: event.target.value }))}/>}
              <div className="filter-actions"><button type="button" onClick={applyColumnFilter}>Apply</button><button type="button" onClick={clearColumnFilter}>Clear column</button></div>
            </div>}
            <div className="column-resize-grip" onPointerDown={event => startColumnResize(event, c)} onDoubleClick={() => autoFitColumn(c)}/>
          </div>
        })}
        {visibleRowIndices.map(r => <div key={`rh${r}`} className="virtual-row-header" data-frozen-col="true" style={{ top: HEADER_HEIGHT + rowOffsets[r], width: ROW_HEADER_WIDTH, height: rowOffsets[r + 1] - rowOffsets[r] }} onClick={() => selectWholeRow(r)}>{r + 1}<div className="row-resize-grip" onPointerDown={event => startRowResize(event, r)}/></div>)}
        {visibleRowIndices.flatMap(r => visibleColumnIndices.map(c => {
          const cell = engine.getCell(r, c), style = styleAt(r, c), selected = rangeContains(r, c), isAnchor = anchor.r === r && anchor.c === c, editing = editingCell?.r === r && editingCell?.c === c
          return <VirtualCell key={`${r}:${c}`} r={r} c={c} raw={cell.raw} computed={cell.computed} error={cell.error} bold={style.bold} italic={style.italic} underline={style.underline} color={style.color} fontSize={style.fontSize} align={style.align} bg={style.bg} numberFormat={style.numberFormat}
            selected={selected} isAnchor={isAnchor} topEdge={selected && r === activeBounds.r1} bottomEdge={selected && r === activeBounds.r2} leftEdge={selected && c === activeBounds.c1} rightEdge={selected && c === activeBounds.c2} editing={editing}
            editValue={editing ? editValue : undefined} inputRef={editing ? inputRef : undefined} onInputChange={editing ? event => setEditValue(event.target.value) : undefined} onInputKeyDown={editing ? onInputKeyDown : undefined} onInputBlur={editing ? () => { if (editingCell) commitEdit() } : undefined}
            top={HEADER_HEIGHT + rowOffsets[r]} left={ROW_HEADER_WIDTH + columnOffsets[c]} width={columnOffsets[c + 1] - columnOffsets[c]} height={rowOffsets[r + 1] - rowOffsets[r]} frozenRow={r < frozen.rows} frozenCol={c < frozen.cols}
            showFillHandle={r === bounds.r2 && c === bounds.c2} onFillStart={r === bounds.r2 && c === bounds.c2 ? event => { event.preventDefault(); event.stopPropagation(); fillDrag.current = { src: { ...bounds }, preview: { ...bounds } }; window.addEventListener('pointermove', handleFillMove); window.addEventListener('pointerup', endFill, { once: true })} : undefined}/>
        }))}
      </div>
    </div>
    {engine.hasActiveFilters() && <div className="filter-status">{engine.getVisibleRowCount()} of {totalDataRows} rows</div>}
    {resizePreview && <div className="resize-status">{resizePreview.value}px</div>}
    <p className="footer-hint">Click to select · Double-click, Enter, F2, or type to edit · Shift+Arrow extends · Ctrl+A selects used cells</p>
    {perfEnabled && <div className="perf-overlay">Commits {perfView.commits} · last commit {perfView.duration.toFixed(2)} ms · scroll frame {perfView.scrollFrame.toFixed(2)} ms · visible cells {visibleRowIndices.length * visibleColumnIndices.length}</div>}
  </div>

  return <div className="app-wrapper">
    <div className="app-header"><h2 className="app-title">📊 Spreadsheet App</h2></div>
    {perfEnabled ? <Profiler id="spreadsheet" onRender={onProfileRender}>{gridContent}</Profiler> : gridContent}
    {aiOpen && <AiPanel engine={engine} selection={selection} onClose={() => setAiOpen(false)} onChanged={() => { force(); setLayoutRevision(value => value + 1) }}/>}
  </div>
}

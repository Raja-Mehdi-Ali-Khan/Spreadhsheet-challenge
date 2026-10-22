import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import './App.css'
import { createEngine } from './engine/core.js'
import { loadSampleSmall, loadSampleLarge } from './fixtures/loadSample.js'

const TOTAL_ROWS = 50
const TOTAL_COLS = 50
const DEFAULT_STYLE = { bold: false, italic: false, underline: false, bg: 'white', color: '#202124', align: 'left', fontSize: 13 }
const filterValueKey = value => String(value ?? '').trim() ? String(value).trim().toLocaleLowerCase() : '(blanks)'

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
  const gridRef = useRef(null)
  const inputRef = useRef(null)
  const filterDropdownRef = useRef(null)
  const mouseSelecting = useRef(false)
  const fillDrag = useRef(null)
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

  const setFocus = useCallback((r, c, extend = false) => {
    setSelection(prev => ({ anchor: extend ? prev.anchor : { r, c }, focus: { r, c } }))
  }, [])
  const commitEdit = useCallback((move = null) => {
    if (!editingCell) return
    const { r, c } = editingCell
    if (engine.getCell(r, c).raw !== editValue) { engine.setCell(r, c, editValue); force() }
    setEditingCell(null)
    if (move) setFocus(Math.max(0, Math.min(engine.rows - 1, r + move.r)), Math.max(0, Math.min(engine.cols - 1, c + move.c)))
  }, [editingCell, editValue, engine, force, setFocus])
  const beginEdit = useCallback((r, c, value) => {
    setSelection({ anchor: { r, c }, focus: { r, c } })
    setEditingCell({ r, c })
    setEditValue(value === undefined ? engine.getCell(r, c).raw : value)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [engine])
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
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (engine.undo()) force(); return }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); if (engine.redo()) force(); return }
    if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); beginEdit(anchor.r, anchor.c); return }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); clearSelection(); return }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      const used = engine.getUsedRange()
      setSelection({ anchor: { r: used.r1, c: used.c1 }, focus: { r: used.r2, c: used.c2 } }); return
    }
    const delta = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key]
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
  }, [engine, anchor, selection, beginEdit, clearSelection, setFocus, force])

  const onGridKeyDown = useCallback((event) => { if (!editingCell) navigateKey(event) }, [editingCell, navigateKey])
  const onInputKeyDown = useCallback((event) => {
    if (event.key === 'Escape') { event.preventDefault(); setEditValue(engine.getCell(editingCell.r, editingCell.c).raw); setEditingCell(null); gridRef.current?.focus() }
    else if (event.key === 'Enter') { event.preventDefault(); commitEdit({ r: 1, c: 0 }); gridRef.current?.focus() }
    else if (event.key === 'Tab') { event.preventDefault(); commitEdit({ r: 0, c: 1 }); gridRef.current?.focus() }
  }, [engine, editingCell, commitEdit])

  const selectWholeColumn = useCallback((column) => {
    if (editingCell) commitEdit()
    setSelection({ anchor: { r: 0, c: column }, focus: { r: engine.rows - 1, c: column } })
    gridRef.current?.focus()
  }, [editingCell, commitEdit, engine])
  const selectWholeRow = useCallback((row) => {
    if (editingCell) commitEdit()
    setSelection({ anchor: { r: row, c: 0 }, focus: { r: row, c: engine.cols - 1 } })
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
    force()
  }, [engine, openFilterColumn, filterDraft, force])
  const clearColumnFilter = useCallback(() => {
    if (openFilterColumn === null) return
    engine.setFilter(openFilterColumn, null)
    setOpenFilterColumn(null)
    force()
  }, [engine, openFilterColumn, force])
  const clearAllFilters = useCallback(() => { engine.clearFilters(); setOpenFilterColumn(null); force() }, [engine, force])
  const sortColumn = useCallback((column) => {
    if (editingCell) commitEdit()
    const cycle = ['asc', 'desc', 'original']
    const direction = sortIndicator?.column === column ? cycle[(cycle.indexOf(sortIndicator.direction) + 1) % cycle.length] : 'asc'
    const multiCellSelection = bounds.r1 !== bounds.r2 || bounds.c1 !== bounds.c2
    const used = engine.getUsedRange()
    const block = multiCellSelection ? bounds : { r1: 0, c1: 0, r2: used.r2, c2: used.c2 }
    engine.sortRange(block, column, direction)
    setSortIndicator({ column, direction })
    force()
  }, [editingCell, commitEdit, sortIndicator, bounds, engine, force])

  const handleFillMove = useCallback((event) => {
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-cell]')
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
  const endFill = useCallback(() => {
    if (!fillDrag.current) return
    const { src, preview } = fillDrag.current
    if (preview.r1 !== src.r1 || preview.c1 !== src.c1 || preview.r2 !== src.r2 || preview.c2 !== src.c2) {
      engine.fillRange(src, preview)
      force()
      setSelection({ anchor: { r: preview.r1, c: preview.c1 }, focus: { r: preview.r2, c: preview.c2 } })
    }
    fillDrag.current = null; setFillPreview(null)
    window.removeEventListener('pointermove', handleFillMove)
  }, [engine, force, handleFillMove])

  const load = (loader) => { loader(engine); force(); setSelection({ anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 } }); setEditingCell(null) }
  const undo = () => { if (engine.undo()) force() }
  const redo = () => { if (engine.redo()) force() }
  const rangeContains = (r, c) => r >= activeBounds.r1 && r <= activeBounds.r2 && c >= activeBounds.c1 && c <= activeBounds.c2

  return <div className="app-wrapper">
    <div className="app-header"><h2 className="app-title">📊 Spreadsheet App</h2></div>
    <div className="main-content">
      <div className="toolbar">
        <button className="toolbar-btn bold-btn" onClick={() => toggleStyle('bold')}>B</button><button className="toolbar-btn italic-btn" onClick={() => toggleStyle('italic')}>I</button><button className="toolbar-btn underline-btn" onClick={() => toggleStyle('underline')}>U</button>
        <select className="toolbar-select" aria-label="Font size" onChange={e => applyStyle({ fontSize: Number(e.target.value) })} defaultValue="13">{[8,10,11,12,13,14,16,18,20,24].map(n => <option key={n}>{n}</option>)}</select>
        {['left','center','right'].map(a => <button key={a} className="align-btn" onClick={() => applyStyle({ align: a })}>{a}</button>)}
        <input type="color" aria-label="Text color" onChange={e => applyStyle({ color: e.target.value })}/>
        <select className="toolbar-select" aria-label="Fill color" onChange={e => applyStyle({ bg: e.target.value })}><option value="white">White</option><option value="#ffff99">Yellow</option><option value="#99ffcc">Green</option><option value="#ffcccc">Red</option><option value="#cce5ff">Blue</option></select>
        <button className="toolbar-btn" onClick={undo} disabled={!engine.canUndo()}>↶ Undo</button><button className="toolbar-btn" onClick={redo} disabled={!engine.canRedo()}>↷ Redo</button>
        <button className="toolbar-btn" onClick={() => { engine.insertRow(anchor.r); force() }}>+ Row</button><button className="toolbar-btn" onClick={() => { engine.deleteRow(anchor.r); force() }}>- Row</button><button className="toolbar-btn" onClick={() => { engine.insertColumn(anchor.c); force() }}>+ Col</button><button className="toolbar-btn" onClick={() => { engine.deleteColumn(anchor.c); force() }}>- Col</button>
        {engine.hasActiveFilters() && <button className="toolbar-btn" onClick={clearAllFilters}>Clear all filters</button>}
        <button className="toolbar-btn danger" onClick={clearSelection}>✕ Clear</button><button className="toolbar-btn" onClick={() => load(loadSampleSmall)}>⬇ Sample 33</button><button className="toolbar-btn" onClick={() => load(loadSampleLarge)}>⬇ Sample 3k</button>
      </div>
      <div className="formula-bar"><span className="formula-bar-label">{label}</span><input className="formula-bar-input" value={editingCell ? editValue : engine.getCell(anchor.r, anchor.c).raw} onFocus={() => { if (!editingCell) { setEditingCell(anchor); setEditValue(engine.getCell(anchor.r, anchor.c).raw) } }} onChange={e => setEditValue(e.target.value)} onKeyDown={onInputKeyDown} onBlur={() => { if (editingCell) commitEdit() }}/></div>
      <div className="grid-scroll" ref={gridRef} tabIndex={0} onKeyDown={onGridKeyDown}
        onPointerMove={event => {
          if (!mouseSelecting.current) return
          const el = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-cell]')
          if (!el) return
          const r = Number(el.dataset.r), c = Number(el.dataset.c)
          setSelection(prev => prev.focus.r === r && prev.focus.c === c ? prev : { anchor: prev.anchor, focus: { r, c } })
        }}
        onPointerUp={() => { mouseSelecting.current = false }}>
        <table className="grid-table">
          <thead><tr><th className="col-header-blank"></th>{Array.from({ length: engine.cols }, (_, c) => {
            const activeFilter = engine.getFilter(c)
            const sortDirection = sortIndicator?.column === c ? sortIndicator.direction : null
            return <th key={c} className="col-header">
              <span className="col-header-label" onClick={() => selectWholeColumn(c)}>{getColumnLabel(c)}</span>
              <span className="header-controls">
                <button type="button" className="header-control" aria-label={`Sort ${getColumnLabel(c)}`} title="Sort ascending, descending, original" onClick={() => sortColumn(c)}>{sortDirection === 'asc' ? '↑' : sortDirection === 'desc' ? '↓' : sortDirection === 'original' ? '↕' : '⇅'}</button>
                <button type="button" className={`header-control ${activeFilter ? 'filter-active' : ''}`} aria-label={`Filter ${getColumnLabel(c)}`} aria-pressed={Boolean(activeFilter)} title="Filter" onClick={() => openColumnFilter(c)}>▾</button>
              </span>
              {openFilterColumn === c && <div className="filter-dropdown" ref={filterDropdownRef} onPointerDown={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpenFilterColumn(null) } }}>
                <input className="filter-search" aria-label="Search values" placeholder="Search values" value={filterDraft.search} onChange={event => setFilterDraft(draft => ({ ...draft, search: event.target.value }))}/>
                <div className="filter-values">{filterOptions.filter(value => value.toLocaleLowerCase().includes(filterDraft.search.trim().toLocaleLowerCase())).map(value => {
                  const valueKey = filterValueKey(value)
                  const checked = filterDraft.selected.includes(valueKey)
                  return <label key={valueKey} className="filter-option"><input type="checkbox" checked={checked} onChange={() => setFilterDraft(draft => ({ ...draft, selected: checked ? draft.selected.filter(item => item !== valueKey) : [...draft.selected, valueKey] }))}/>{value}</label>
                })}</div>
                <label className="filter-condition-label">Condition
                  <select value={filterDraft.conditionOp} onChange={event => setFilterDraft(draft => ({ ...draft, conditionOp: event.target.value }))}>
                    <option value="">None</option><option value="contains">Contains</option><option value="gt">Greater than</option><option value="lt">Less than</option><option value="empty">Is empty</option>
                  </select>
                </label>
                {filterDraft.conditionOp && filterDraft.conditionOp !== 'empty' && <input className="filter-search" aria-label="Condition value" value={filterDraft.conditionValue} onChange={event => setFilterDraft(draft => ({ ...draft, conditionValue: event.target.value }))}/>}
                <div className="filter-actions"><button type="button" onClick={applyColumnFilter}>Apply</button><button type="button" onClick={clearColumnFilter}>Clear column</button></div>
              </div>}
            </th>
          })}</tr></thead>
          <tbody>{Array.from({ length: engine.rows }, (_, row) => row).filter(row => !engine.isRowHidden(row)).map(r => <tr key={r}>
            <td className="row-header" onClick={() => selectWholeRow(r)}>{r + 1}</td>
            {Array.from({ length: engine.cols }, (_, c) => {
              const cell = engine.getCell(r, c), style = styleAt(r, c), selected = rangeContains(r, c), isAnchor = anchor.r === r && anchor.c === c, editing = editingCell?.r === r && editingCell?.c === c
              const display = cell.error || ((cell.computed !== null && cell.computed !== '') ? String(cell.computed) : cell.raw)
              return <td key={c} data-cell data-r={r} data-c={c} className={`cell ${selected ? 'in-selection' : ''} ${isAnchor ? 'anchor-cell' : ''} ${selected && r === activeBounds.r1 ? 'selection-top' : ''} ${selected && r === activeBounds.r2 ? 'selection-bottom' : ''} ${selected && c === activeBounds.c1 ? 'selection-left' : ''} ${selected && c === activeBounds.c2 ? 'selection-right' : ''}`} style={{ background: style.bg }}
                onPointerDown={event => {
                  if (event.target.classList.contains('fill-handle')) return
                  event.preventDefault()
                  if (editing) return
                  if (selection.anchor.r === r && selection.anchor.c === c && event.detail > 1) { beginEdit(r, c); return }
                  selectCell(r, c, event.shiftKey)
                  mouseSelecting.current = true
                  window.addEventListener('pointerup', () => { mouseSelecting.current = false }, { once: true })
                }}
                onDoubleClick={() => beginEdit(r, c)}>
                {editing ? <input ref={inputRef} className="cell-input" value={editValue} onChange={event => setEditValue(event.target.value)} onKeyDown={onInputKeyDown} onBlur={() => { if (editingCell) commitEdit() }} style={{ fontWeight: style.bold ? 'bold' : 'normal', fontStyle: style.italic ? 'italic' : 'normal', textDecoration: style.underline ? 'underline' : 'none', color: style.color, fontSize: style.fontSize + 'px', textAlign: style.align, background: style.bg }}/> : <div className={`cell-display align-${style.align} ${cell.error ? 'error' : ''}`} style={{ fontWeight: style.bold ? 'bold' : 'normal', fontStyle: style.italic ? 'italic' : 'normal', textDecoration: style.underline ? 'underline' : 'none', color: cell.error ? '#d93025' : style.color, fontSize: style.fontSize + 'px' }}>{display}</div>}
                {r === bounds.r2 && c === bounds.c2 && <button aria-label="Fill handle" className="fill-handle" onPointerDown={event => { event.preventDefault(); event.stopPropagation(); fillDrag.current = { src: { ...bounds }, preview: { ...bounds } }; window.addEventListener('pointermove', handleFillMove); window.addEventListener('pointerup', endFill, { once: true }) }}/>}
              </td>
            })}
          </tr>)}</tbody>
        </table>
      </div>
      {engine.hasActiveFilters() && <div className="filter-status">{engine.getVisibleRowCount()} of {totalDataRows} rows</div>}
      <p className="footer-hint">Click to select · Double-click, Enter, F2, or type to edit · Shift+Arrow extends · Ctrl+A selects used cells</p>
    </div>
  </div>
}

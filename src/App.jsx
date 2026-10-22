import { useState, useRef, useCallback, useMemo } from 'react'
import './App.css'
import { createEngine } from './engine/core.js'
import { loadSampleSmall, loadSampleLarge } from './fixtures/loadSample.js'

const TOTAL_ROWS = 50
const TOTAL_COLS = 50
const DEFAULT_STYLE = { bold: false, italic: false, underline: false, bg: 'white', color: '#202124', align: 'left', fontSize: 13 }

export default function App() {
  const [engine] = useState(() => createEngine(TOTAL_ROWS, TOTAL_COLS))
  const [, setVersion] = useState(0)
  const [selection, setSelection] = useState({ anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 } })
  const [editingCell, setEditingCell] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [cellStyles, setCellStyles] = useState({})
  const [fillPreview, setFillPreview] = useState(null)
  const gridRef = useRef(null)
  const inputRef = useRef(null)
  const mouseSelecting = useRef(false)
  const fillDrag = useRef(null)
  const force = useCallback(() => setVersion(v => v + 1), [])
  const anchor = selection.anchor
  const styleAt = useCallback((r, c) => ({ ...DEFAULT_STYLE, ...cellStyles[`${r},${c}`] }), [cellStyles])
  const bounds = useMemo(() => ({ r1: Math.min(selection.anchor.r, selection.focus.r), c1: Math.min(selection.anchor.c, selection.focus.c), r2: Math.max(selection.anchor.r, selection.focus.r), c2: Math.max(selection.anchor.c, selection.focus.c) }), [selection])
  const activeBounds = fillPreview || bounds
  const getColumnLabel = useCallback((col) => { let label = ''; for (let n = col + 1; n; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + ((n - 1) % 26)) + label; return label }, [])
  const label = `${getColumnLabel(anchor.c)}${anchor.r + 1}`

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
    for (let r = bounds.r1; r <= bounds.r2; r++) for (let c = bounds.c1; c <= bounds.c2; c++) entries.push([`${r},${c}`, { ...styleAt(r, c), ...updates }])
    setCellStyles(prev => ({ ...prev, ...Object.fromEntries(entries) }))
  }, [bounds, styleAt])
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
      setFocus(Math.max(0, Math.min(engine.rows - 1, selection.focus.r + delta[0])), Math.max(0, Math.min(engine.cols - 1, selection.focus.c + delta[1])), event.shiftKey)
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
      const updates = {}
      for (let r = preview.r1; r <= preview.r2; r++) for (let c = preview.c1; c <= preview.c2; c++) {
        if (r >= src.r1 && r <= src.r2 && c >= src.c1 && c <= src.c2) continue
        const seedR = src.r1 + ((r - src.r1) % (src.r2 - src.r1 + 1) + (src.r2 - src.r1 + 1)) % (src.r2 - src.r1 + 1)
        const seedC = src.c1 + ((c - src.c1) % (src.c2 - src.c1 + 1) + (src.c2 - src.c1 + 1)) % (src.c2 - src.c1 + 1)
        updates[`${r},${c}`] = styleAt(seedR, seedC)
      }
      if (Object.keys(updates).length) setCellStyles(prev => ({ ...prev, ...updates }))
      force()
      setSelection({ anchor: { r: preview.r1, c: preview.c1 }, focus: { r: preview.r2, c: preview.c2 } })
    }
    fillDrag.current = null; setFillPreview(null)
    window.removeEventListener('pointermove', handleFillMove)
  }, [engine, force, handleFillMove, styleAt])

  const load = (loader) => { loader(engine); force(); setSelection({ anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 } }); setEditingCell(null); setCellStyles({}) }
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
        <button className="toolbar-btn danger" onClick={clearSelection}>✕ Clear</button><button className="toolbar-btn" onClick={() => load(loadSampleSmall)}>⬇ Sample 33</button><button className="toolbar-btn" onClick={() => load(loadSampleLarge)}>⬇ Sample 3k</button>
      </div>
      <div className="formula-bar"><span className="formula-bar-label">{label}</span><input className="formula-bar-input" value={editingCell ? editValue : engine.getCell(anchor.r, anchor.c).raw} onFocus={() => { if (!editingCell) { setEditingCell(anchor); setEditValue(engine.getCell(anchor.r, anchor.c).raw) } }} onChange={e => setEditValue(e.target.value)} onKeyDown={onInputKeyDown} onBlur={() => { if (editingCell) commitEdit() }}/></div>
      <div className="grid-scroll" ref={gridRef} tabIndex={0} onKeyDown={onGridKeyDown} onPointerMove={event => { if (mouseSelecting.current) { const el = document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-cell]'); if (el) { const r = Number(el.dataset.r), c = Number(el.dataset.c); setSelection(prev => prev.focus.r === r && prev.focus.c === c ? prev : { anchor: prev.anchor, focus: { r, c } }) } } }} onPointerUp={() => { mouseSelecting.current = false }}>
        <table className="grid-table"><thead><tr><th className="col-header-blank"></th>{Array.from({length:engine.cols},(_,c)=><th key={c} className="col-header" onClick={() => { if (editingCell) commitEdit(); setSelection({anchor:{r:0,c},focus:{r:engine.rows-1,c}}); gridRef.current?.focus() }}>{getColumnLabel(c)}</th>)}</tr></thead><tbody>{Array.from({length:engine.rows},(_,r)=><tr key={r}><td className="row-header" onClick={() => {if (editingCell) commitEdit(); setSelection({anchor:{r,c:0},focus:{r,c:engine.cols-1}});gridRef.current?.focus()}}>{r+1}</td>{Array.from({length:engine.cols},(_,c)=>{
          const cell=engine.getCell(r,c), style=styleAt(r,c), selected=rangeContains(r,c), isAnchor=anchor.r===r&&anchor.c===c, editing=editingCell?.r===r&&editingCell?.c===c
          const display=cell.error||((cell.computed!==null&&cell.computed!=='')?String(cell.computed):cell.raw)
          return <td key={c} data-cell data-r={r} data-c={c} className={`cell ${selected?'in-selection':''} ${isAnchor?'anchor-cell':''} ${selected&&r===activeBounds.r1?'selection-top':''} ${selected&&r===activeBounds.r2?'selection-bottom':''} ${selected&&c===activeBounds.c1?'selection-left':''} ${selected&&c===activeBounds.c2?'selection-right':''}`} style={{background:style.bg}} onPointerDown={e=>{if(e.target.classList.contains('fill-handle'))return; e.preventDefault(); if(editing) return; if(selection.anchor.r===r&&selection.anchor.c===c&&e.detail>1){beginEdit(r,c);return} selectCell(r,c,e.shiftKey); mouseSelecting.current=true; window.addEventListener('pointerup', () => { mouseSelecting.current = false }, { once: true })}} onDoubleClick={()=>beginEdit(r,c)}>
            {editing?<input ref={inputRef} className="cell-input" value={editValue} onChange={e=>setEditValue(e.target.value)} onKeyDown={onInputKeyDown} onBlur={()=>{if(editingCell)commitEdit()}} style={{fontWeight:style.bold?'bold':'normal',fontStyle:style.italic?'italic':'normal',textDecoration:style.underline?'underline':'none',color:style.color,fontSize:style.fontSize+'px',textAlign:style.align,background:style.bg}}/>:<div className={`cell-display align-${style.align} ${cell.error?'error':''}`} style={{fontWeight:style.bold?'bold':'normal',fontStyle:style.italic?'italic':'normal',textDecoration:style.underline?'underline':'none',color:cell.error?'#d93025':style.color,fontSize:style.fontSize+'px'}}>{display}</div>}
            {r===bounds.r2&&c===bounds.c2&&<button aria-label="Fill handle" className="fill-handle" onPointerDown={e=>{e.preventDefault();e.stopPropagation();fillDrag.current={src:{...bounds},preview:{...bounds}};window.addEventListener('pointermove',handleFillMove);window.addEventListener('pointerup',endFill,{once:true})}}/>}
          </td>
        })}</tr>)}</tbody></table>
      </div>
      <p className="footer-hint">Click to select · Double-click, Enter, F2, or type to edit · Shift+Arrow extends · Ctrl+A selects used cells</p>
    </div>
  </div>
}

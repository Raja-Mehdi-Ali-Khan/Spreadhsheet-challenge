import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createProvider } from './ai/provider.js'
import { extractJson } from './ai/parse.js'
import { validateAction } from './ai/validate.js'
import { readSheet, buildSheetContext } from './ai/context.js'
import { executeQuery } from './ai/executor.js'
import { describePlan } from './ai/describe.js'
import { insertQueryResult, rerunStoredPlan } from './ai/workflow.js'
import './AiPanel.css'

const rules = `You translate the user's question into exactly one allowed JSON action. Reply with a single JSON object and nothing else. Use sheet header names verbatim. The program computes results; never invent or state result numbers. A query has type="query" and optional excludeTotalsRow:boolean, filters:[{column:string,op,value?:string|number|null}], groupBy:string[], aggregates:[{fn,column,as?}], columns:string[], sort:[{column,dir?:"asc"|"desc"}], limit:positive integer. A clarify action has type="clarify" and question:string. The app is read-only: never propose a mutation or format_sheet. Filter ops are eq, neq, gt, gte, lt, lte, contains, startsWith, endsWith, isEmpty, notEmpty; all filters combine with AND. Aggregate fns are sum, avg, count, countDistinct, min, max. Row one is the header; rows with all blank cells are skipped; the last totals row is excluded by default. Group names and output sort names must be exact header/output names. Results are limited to 500 rows. Context: `
const selectionLabel = point => { let col='';for(let n=point.c+1;n;n=Math.floor((n-1)/26))col=String.fromCharCode(65+(n-1)%26)+col;return `${col}${point.r+1}` }

export default function AiPanel({ engine, selection, onClose, onChanged }) {
  const [prompt,setPrompt]=useState(''),[history,setHistory]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[question,setQuestion]=useState(''),[plan,setPlan]=useState(null),[result,setResult]=useState(null),[showPlan,setShowPlan]=useState(false),[target,setTarget]=useState(''),[insertError,setInsertError]=useState('')
  const inputRef=useRef(null), provider=useMemo(()=>createProvider(),[])
  const current=useCallback(()=>{const sheet=readSheet(engine);return {sheet,context:buildSheetContext(sheet,`R${selection.anchor.r+1}C${selection.anchor.c+1}`)}},[engine,selection])
  useEffect(()=>{inputRef.current?.focus()},[])
  const run=useCallback((storedPlan)=>{const {sheet}=current();const next=executeQuery(sheet.rows,storedPlan);setResult(next);setPlan(storedPlan);setError(next.error?`${next.error}: ${next.detail||''}`:'');setQuestion(['UNKNOWN_COLUMN','UNKNOWN_SORT_COLUMN'].includes(next.error)?`Which column did you mean by “${next.detail?.split(':').slice(1).join(':')}”?`: '')},[current])
  const ask=useCallback(async()=>{
    const typed=prompt.trim();if(!typed||busy)return
    setBusy(true);setError('');setQuestion('');setInsertError('')
    try {
      const start=selectionLabel(selection.anchor),end=selectionLabel(selection.focus),selectionRange=start===end?start:`${start}:${end}`
      const {context}=current(), system=`${rules}\n${JSON.stringify({...context,selection:selectionRange})}`
      const response=await provider.complete({system,user:typed,history})
      const parsed=extractJson(response.text)
      if(parsed?.error){setError(`${parsed.error}: ${parsed.detail}`);return}
      const action=validateAction(parsed)
      if(action?.error){setError(`${action.error}: ${action.detail}`);return}
      const nextHistory=[...history,{role:'user',content:typed},{role:'assistant',content:response.text}]
      setHistory(nextHistory);setPrompt('')
      if(action.type==='clarify'){setPlan(action);setResult(null);setQuestion(action.question);return}
      if(action.type!=='query'){setError('READ_ONLY: Only query and clarify actions can be run.');return}
      run(action)
    } catch(err) { setError(err.message || 'Provider request failed') }
    finally { setBusy(false) }
  },[prompt,busy,current,provider,history,run,selection])
  const rerun=()=>{if(plan?.type==='query'){const next=rerunStoredPlan(engine,plan);setResult(next);setError(next.error?`${next.error}: ${next.detail||''}`:'')}}
  const insert=()=>{
    if(!result||result.error)return
    const outcome=insertQueryResult(engine,result,target,selection.anchor)
    if(outcome.error){setInsertError(outcome.detail);return}
    onChanged();setInsertError('Inserted in one undo step.')
  }
  return <aside className="ai-panel" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();onClose()}}}>
    <header><strong>Ask your data</strong><button onClick={onClose} aria-label="Close Ask your data">×</button></header>
    <div className="ai-panel-body">
      <label htmlFor="ai-prompt">Question</label><textarea id="ai-prompt" ref={inputRef} value={prompt} onChange={e=>setPrompt(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();ask()}}} placeholder="Ask a question about this sheet"/>
      <button disabled={busy||!prompt.trim()} onClick={ask}>{busy?'Thinking…':'Ask'}</button>
      {question&&<p className="ai-message">{question}</p>}{error&&<p className="ai-error">{error}</p>}
      {plan?.type==='query'&&<section className="ai-result"><p>{describePlan(plan)}</p><button onClick={()=>setShowPlan(value=>!value)}>{showPlan?'Hide plan':'Show plan'}</button>{showPlan&&<pre>{JSON.stringify(plan,null,2)}</pre>}
        {result&&!result.error&&<><p>{result.rowCount} rows{result.truncated?' (truncated to the result limit)':''}</p><div className="ai-table-wrap"><table><thead><tr>{result.columns.map((c,i)=><th key={i}>{c}</th>)}</tr></thead><tbody>{result.rows.slice(0,100).map((row,r)=><tr key={r}>{row.map((v,c)=><td key={c}>{String(v??'')}</td>)}</tr>)}</tbody></table></div>
          <button onClick={rerun}>Re-run</button><label>Target cell <input value={target} onChange={e=>setTarget(e.target.value)} placeholder={`${selectionLabel(selection.anchor)}`}/></label><button onClick={insert}>Insert into sheet</button>{insertError&&<p className="ai-message">{insertError}</p>}</>}
      </section>}
      {!!history.length&&<details><summary>Conversation ({history.filter(t=>t.role==='user').length})</summary>{history.map((turn,i)=><p key={i}><strong>{turn.role==='user'?'You':'Assistant'}:</strong> {turn.content}</p>)}</details>}
    </div>
  </aside>
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createProvider } from './ai/provider.js'
import { extractJson } from './ai/parse.js'
import { validateAction } from './ai/validate.js'
import { readSheet, buildSheetContext } from './ai/context.js'
import { executeQuery } from './ai/executor.js'
import { describePlan } from './ai/describe.js'
import { insertQueryResult, rerunStoredPlan } from './ai/workflow.js'
import { describeFormat, planFormat } from './ai/applier.js'
import './AiPanel.css'

const rules = `Translate the user's request into exactly one allowed JSON action. Reply with one JSON object only. Use sheet headers verbatim. Query: {type:"query", excludeTotalsRow?:boolean, filters?:[{column:string,op:string,value?:string|number|null}], groupBy?:string[], aggregates?:[{fn:string,column:string,as?:string}], columns?:string[], sort?:[{column:string,dir?:"asc"|"desc"}], limit?:positive integer}. Clarify: {type:"clarify",question:string}. Formatting: {type:"format_sheet",clearFormatting?:boolean,headerStyle?:style,bodyStyle?:style,totalsStyle?:style,columns?:[{col:integer,style}],freezeRows?:integer|null,columnWidths?:[{col:integer,width:integer}],autoFitColumns?:boolean}; style may include bold,italic,underline,bg,color,align,fontSize,numberFormat, and numberFormat is general|number|currency|percent|date. Use format_sheet only for formatting requests. The program calculates all query results; never invent result numbers. Filter ops: eq,neq,gt,gte,lt,lte,contains,startsWith,endsWith,isEmpty,notEmpty; filters are ANDed. Aggregate functions: sum,avg,count,countDistinct,min,max. Row one is the header; all-blank rows are skipped and the last totals row is excluded by default. Group and sort names must match exact headers or output names. Queries return at most 500 rows. Context: `
const selectionLabel = point => { let col='';for(let n=point.c+1;n;n=Math.floor((n-1)/26))col=String.fromCharCode(65+(n-1)%26)+col;return `${col}${point.r+1}` }

export default function AiPanel({ engine, selection, onClose, onChanged }) {
  const [prompt,setPrompt]=useState(''),[history,setHistory]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[question,setQuestion]=useState(''),[plan,setPlan]=useState(null),[result,setResult]=useState(null),[formatAction,setFormatAction]=useState(null),[formatResult,setFormatResult]=useState(''),[showPlan,setShowPlan]=useState(false),[target,setTarget]=useState(''),[insertError,setInsertError]=useState('')
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
      if(action.type==='clarify'){setFormatAction(null);setFormatResult('');setPlan(action);setResult(null);setQuestion(action.question);return}
      if(action.type==='format_sheet'){setFormatAction(action);setFormatResult('');setPlan(null);setResult(null);return}
      if(action.type!=='query'){setError('READ_ONLY: Only query and clarify actions can be run.');return}
      setFormatAction(null);setFormatResult('')
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
  const applyFormat=()=>{
    if(!formatAction)return
    const sheet=readSheet(engine),frozen=engine.getFrozen()
    const plan=planFormat(formatAction,{...sheet,colCount:sheet.usedRange.c2-sheet.usedRange.c1+1,headerRow:sheet.usedRange.r1,frozenRows:frozen.rows,getStyle:(r,c)=>engine.getStyle(r,c),getColWidth:c=>engine.getColWidth(c)})
    if(plan.result==='OUT_OF_RANGE'){setFormatResult(plan.result);return}
    engine.batch(()=>{
      if(plan.edits.length)engine.setStyles(plan.edits,true)
      if(plan.freezeRows!==null)engine.setFrozen({...frozen,rows:plan.freezeRows})
      for(const item of plan.widths)engine.setColWidth(item.col,item.width)
    })
    setFormatResult(plan.result);onChanged()
  }
  return <aside className="ai-panel" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();onClose()}}}>
    <header><strong>Ask your data</strong><button onClick={onClose} aria-label="Close Ask your data">×</button></header>
    <div className="ai-panel-body">
      <label htmlFor="ai-prompt">Question</label><textarea id="ai-prompt" ref={inputRef} value={prompt} onChange={e=>setPrompt(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();ask()}}} placeholder="Ask a question about this sheet"/>
      <button disabled={busy||!prompt.trim()} onClick={ask}>{busy?'Thinking…':'Ask'}</button>
      {question&&<p className="ai-message">{question}</p>}{error&&<p className="ai-error">{error}</p>}
      {formatAction&&<section className="ai-result"><h3>Formatting preview</h3><p>{describeFormat(formatAction)}</p><button onClick={()=>setShowPlan(value=>!value)}>{showPlan?'Hide plan':'Show plan'}</button>{showPlan&&<pre>{JSON.stringify(formatAction,null,2)}</pre>}{formatResult?<p className={formatResult==='OUT_OF_RANGE'?'ai-error':'ai-message'}>Result: {formatResult}</p>:<div className="ai-format-actions"><button onClick={applyFormat}>Apply</button><button onClick={()=>{setFormatAction(null);setFormatResult('')}}>Discard</button></div>}</section>}
      {plan?.type==='query'&&<section className="ai-result"><p>{describePlan(plan)}</p><button onClick={()=>setShowPlan(value=>!value)}>{showPlan?'Hide plan':'Show plan'}</button>{showPlan&&<pre>{JSON.stringify(plan,null,2)}</pre>}
        {result&&!result.error&&<><p>{result.rowCount} rows{result.truncated?' (truncated to the result limit)':''}</p><div className="ai-table-wrap"><table><thead><tr>{result.columns.map((c,i)=><th key={i}>{c}</th>)}</tr></thead><tbody>{result.rows.slice(0,100).map((row,r)=><tr key={r}>{row.map((v,c)=><td key={c}>{String(v??'')}</td>)}</tr>)}</tbody></table></div>
          <button onClick={rerun}>Re-run</button><label>Target cell <input value={target} onChange={e=>setTarget(e.target.value)} placeholder={`${selectionLabel(selection.anchor)}`}/></label><button onClick={insert}>Insert into sheet</button>{insertError&&<p className="ai-message">{insertError}</p>}</>}
      </section>}
      {!!history.length&&<details><summary>Conversation ({history.filter(t=>t.role==='user').length})</summary>{history.map((turn,i)=><p key={i}><strong>{turn.role==='user'?'You':'Assistant'}:</strong> {turn.content}</p>)}</details>}
    </div>
  </aside>
}

import { describe, expect, it } from 'vitest'
import { createEngine } from '../engine/core.js'
import { loadSampleLarge } from '../fixtures/loadSample.js'
import { createMockProvider } from './mockProvider.js'
import { extractJson } from './parse.js'
import { validateAction } from './validate.js'
import { readSheet } from './context.js'
import { executeQuery, norm, toDate, toNum } from './executor.js'
import { insertQueryResult, rerunStoredPlan } from './workflow.js'
import casesFile from '../../fixtures/ai-eval/queries.json'

const sameRows = (actual, expected) => {
  expect(actual.length).toBe(expected.length)
  actual.forEach((row,r)=>row.forEach((value,c)=>{
    if(typeof value==='number'&&typeof expected[r][c]==='number')expect(Math.abs(value-expected[r][c])).toBeLessThanOrEqual(.01)
    else expect(value).toEqual(expected[r][c])
  }))
}

describe('AI query golden set', () => {
  it('runs all 20 mock prompts through parse, validation and deterministic execution', async () => {
    const engine=createEngine(100000,200);loadSampleLarge(engine)
    const sheet=readSheet(engine),provider=createMockProvider(),passed=[]
    for(const testCase of casesFile.cases){
      const response=await provider.complete({user:testCase.prompt})
      const action=validateAction(extractJson(response.text))
      const expected=testCase.expect
      if(expected.error==='READ_ONLY'){expect(action.error,`${testCase.id}`).toBe('READ_ONLY');passed.push(testCase.id);continue}
      expect(action.error,`${testCase.id} validation`).toBeUndefined()
      const result=executeQuery(sheet.rows,action)
      if(expected.error){expect(result.error,`${testCase.id}`).toBe(expected.error);if(expected.detail)expect(result.detail).toBe(expected.detail)}
      else {expect(result.error,`${testCase.id}`).toBeUndefined();expect(result.columns).toEqual(expected.columns);expect(result.rowCount).toBe(expected.rowCount);expect(result.truncated).toBe(expected.truncated)
        if(expected.rows) { if(action.sort?.length) sameRows(result.rows,expected.rows); else { const expectedSorted=[...expected.rows].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));sameRows([...result.rows].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),expectedSorted) } }
        if(expected.rowsPreview)sameRows(result.rows.slice(0,10),expected.rowsPreview)
      }
      passed.push(testCase.id)
    }
    console.log(`AI query golden cases: ${passed.length}/${casesFile.cases.length} passed`)
    expect(passed).toHaveLength(20)
  },30000)
})

describe('AI query helpers',()=>{
  it('normalises text, currency, percent and sample dates',()=>{expect(norm(' West ')).toBe('west');expect(toNum('$1,200.00')).toBe(1200);expect(toNum('10%')).toBe(.1);expect(toNum('N/A')).toBeNull();expect(toDate('15 Jan 2024')).toBe('2024-01-15');expect(toDate('1/15/2024')).toBe('2024-01-15')})
  it('clamps result limits and reports unknown columns',()=>{const data=[['Name'],['A'],['B']];expect(executeQuery(data,{type:'query',limit:900}).rows).toHaveLength(2);expect(executeQuery(data,{type:'query',groupBy:['Nmae']}).error).toBe('UNKNOWN_COLUMN')})
  it('validates format actions and rejects malformed styles',()=>{expect(validateAction({type:'format_sheet'})).toMatchObject({type:'format_sheet'});expect(validateAction({type:'format_sheet',headerStyle:{bold:'yes'}}).error).toBe('INVALID_RESPONSE')})
  it('parses prose, fences and trailing text, rejecting missing JSON',()=>{expect(extractJson('Answer: ```json\n{"type":"clarify","question":"Which?"}\n```')).toMatchObject({type:'clarify'});expect(extractJson('{"type":"clarify","question":"Which?"} trailing')).toMatchObject({type:'clarify'});expect(extractJson('not json').error).toBe('INVALID_RESPONSE')})
  it('reports validator failures at their schema paths',()=>{
    expect(validateAction({type:'query',filters:[{column:'Region',op:'near'}]})).toMatchObject({error:'INVALID_RESPONSE',detail:'$.filters[0].op is invalid'})
    expect(validateAction({type:'query',limit:0})).toMatchObject({error:'INVALID_RESPONSE',detail:'$.limit must be an integer >= 1'})
    expect(validateAction({type:'query',extra:true})).toMatchObject({error:'INVALID_RESPONSE',detail:'$.extra is not allowed'})
    expect(validateAction({type:'clarify'})).toMatchObject({error:'INVALID_RESPONSE',detail:'$.question is required'})
  })
  it('reruns a stored plan without using a provider and inserts with one undo',()=>{
    const engine=createEngine(10,5);engine.setCells([{r:0,c:0,value:'Name'},{r:1,c:0,value:'Ada'}]);const plan={type:'query',columns:['Name']}
    const provider={complete:()=>{throw new Error('rerun must not call provider')}}
    const result=rerunStoredPlan(engine,plan);expect(result.rows).toEqual([['Ada']]);expect(provider).toBeTruthy()
    const outcome=insertQueryResult(engine,result,'C1',{r:0,c:0});expect(outcome.written).toBe(2);expect(engine.getCell(1,2).raw).toBe('Ada');expect(engine.undo()).toBe(true);expect(engine.getCell(0,2).raw).toBe('')
  })
})

describe('AI query performance',()=>{
  it('runs the q01 golden plan on sales-large in under 50 ms (median of 10)',()=>{
    const engine=createEngine(100000,200);loadSampleLarge(engine);const rows=readSheet(engine).rows,plan=casesFile.cases[0].plan,times=[]
    for(let i=0;i<10;i++){const start=performance.now();executeQuery(rows,plan);times.push(performance.now()-start)}
    times.sort((a,b)=>a-b);const median=(times[4]+times[5])/2
    console.log(`sales-large q01 query median of 10: ${median.toFixed(2)} ms`)
    expect(median).toBeLessThan(50)
  })
  it('runs two-level grouping over 100,000 rows in under 500 ms (median of 10)',()=>{
    const rows=[['Region','Category','Total']];for(let i=0;i<100000;i++)rows.push([`R${i%5}`,`C${i%20}`,String(i)])
    const plan={type:'query',groupBy:['Region','Category'],aggregates:[{fn:'sum',column:'Total'}]},times=[]
    for(let i=0;i<10;i++){const start=performance.now();executeQuery(rows,plan);times.push(performance.now()-start)}
    times.sort((a,b)=>a-b);const median=(times[4]+times[5])/2
    console.log(`100k two-key group-by median of 10: ${median.toFixed(2)} ms`)
    expect(median).toBeLessThan(500)
  })
})

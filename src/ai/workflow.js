import { readSheet } from './context.js'
import { executeQuery } from './executor.js'

export function rerunStoredPlan(engine, plan) {
  return executeQuery(readSheet(engine).rows, plan)
}

function label(col) { let text='';for(let n=col+1;n;n=Math.floor((n-1)/26))text=String.fromCharCode(65+(n-1)%26)+text;return text }

export function insertQueryResult(engine, result, target, anchor) {
  const address=String(target||`${label(anchor.c)}${anchor.r+1}`).trim().toUpperCase().match(/^([A-Z]+)(\d+)$/)
  if(!address)return {error:'INVALID_TARGET',detail:'Enter a target such as A1.'}
  let c=0;for(const letter of address[1])c=c*26+letter.charCodeAt(0)-64;c--
  const r=Number(address[2])-1, matrix=[result.columns,...result.rows]
  if(r<0||c<0||r+matrix.length>engine.rows||c+Math.max(0,...matrix.map(row=>row.length))>engine.cols)return {error:'OUT_OF_RANGE',detail:'The result would write outside the grid.'}
  const entries=[];matrix.forEach((row,ri)=>row.forEach((value,ci)=>entries.push({r:r+ri,c:c+ci,value:String(value??'')})))
  engine.setCells(entries)
  return {written:entries.length}
}

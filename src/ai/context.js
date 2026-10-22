const norm = value => String(value ?? '').trim().toLowerCase()
const colLabel = col => { let s='';for(let n=col+1;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s }
function typeOf(values) {
  const nonblank=values.map(v=>String(v??'').trim()).filter(Boolean)
  if(!nonblank.length)return 'text'
  if(nonblank.every(v=>/^ORD[- ]/i.test(v)))return 'id'
  if(nonblank.every(v=>/^\$?\s*-?\d[\d,]*(\.\d+)?%?$/.test(v)))return nonblank.some(v=>v.includes('$'))?'currency':nonblank.some(v=>v.includes('%'))?'percent':'number'
  if(nonblank.filter(v=>/^\d{4}-\d{1,2}-\d{1,2}$|^\d{1,2}\/\d{1,2}\/\d{4}$|^\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}$/.test(v)).length>=nonblank.length*.7)return 'date'
  return 'text'
}
export function buildSheetContext(sheet, selection) {
  const {r1,c1,r2,c2}=sheet.usedRange
  const headers=sheet.rows[0]||[]
  const columns=headers.map((name,index)=>({name:String(name??''),index,type:typeOf(sheet.rows.slice(1).map(row=>row[index])),examples:[...new Set(sheet.rows.slice(1).map(row=>String(row[index]??'').trim()).filter(Boolean))].slice(0,3)}))
  const first=sheet.rows.find(row=>row.some(v=>norm(v)))?.[0]??''
  const last=sheet.rows.at(-1)?.find(v=>norm(v))??''
  return {range:`${colLabel(c1)}${r1+1}:${colLabel(c2)}${r2+1}`,rowCount:Math.max(0,sheet.rows.length-1),columns,sampleRows:sheet.rows.slice(1,6),selection,hasTotalsRow:/^(grand\s+)?(total|totals|subtotal|sum)\b/i.test(String(last).trim())||/^(grand\s+)?(total|totals|subtotal|sum)\b/i.test(String(first).trim())}
}
export function readSheet(engine) {
  const usedRange=engine.getUsedRange(),rows=[]
  for(let r=usedRange.r1;r<=usedRange.r2;r++){const row=[];for(let c=usedRange.c1;c<=usedRange.c2;c++){const cell=engine.getCell(r,c);row.push(cell.error||(cell.raw.startsWith('=')?cell.computed:cell.raw))}rows.push(row)}
  return {usedRange,rows}
}

import { toDate, toNum } from './executor.js'
import { formatDisplay } from '../format/display.js'

const TOTALS = /^(grand\s+)?(total|totals|subtotal|sum)\b/i
const canonical = value => JSON.stringify(Object.fromEntries(Object.entries(value || {}).sort(([a],[b])=>a.localeCompare(b))))

export function looksLikeTotalsRow(row = []) {
  const filled=row.map(value=>String(value??'').trim()).filter(Boolean)
  if(!filled.length)return false
  if(TOTALS.test(filled[0]))return true
  const first=filled[0]
  const nonNumericLabel=toNum(first)===null&&toDate(first)===null
  const numericTail=row.slice(row.findIndex(value=>String(value??'').trim()===first)+1).filter(value=>String(value??'').trim()).every(value=>toNum(value)!==null)
  return nonNumericLabel&&numericTail&&filled.length>=2&&filled.length<row.length&&row.some(value=>!String(value??'').trim())
}

function styleWords(style={}) {
  const words=[]
  if(style.bold)words.push('bold');if(style.italic)words.push('italic');if(style.underline)words.push('underlined')
  if(style.bg){const colors={'#f0f0f0':'grey','#cce5ff':'blue','#ffff99':'yellow','white':'white'};words.push(colors[style.bg.toLowerCase()]||style.bg)}
  if(style.color)words.push(`text ${style.color}`)
  if(style.align)words.push(`${style.align}-aligned`)
  if(style.fontSize)words.push(`${style.fontSize} pt`)
  return words
}
export function describeFormat(action) {
  const parts=[]
  const header=styleWords(action.headerStyle);if(header.length)parts.push(`header: ${header.join(', ')}`)
  if(action.bodyStyle){const body=styleWords(action.bodyStyle);if(body.length)parts.push(`body: ${body.join(', ')}`)}
  const formats=(action.columns||[]).filter(item=>item.style?.numberFormat).length
  if(formats)parts.push(`${formats} columns: number formats`)
  if((action.columns||[]).some(item=>item.style?.align))parts.push('column alignment')
  if(action.clearFormatting)parts.push('clear existing formatting')
  if(action.freezeRows!==undefined&&action.freezeRows!==null)parts.push(action.freezeRows===0?'unfreeze rows':`freeze ${action.freezeRows} row${action.freezeRows===1?'':'s'}`)
  if(action.columnWidths?.length)parts.push(`${action.columnWidths.length} column widths`)
  if(action.autoFitColumns)parts.push('auto-fit columns')
  if(action.totalsStyle){const totals=styleWords(action.totalsStyle);if(totals.length)parts.push(`totals row: ${totals.join(', ')}`)}
  return parts.join('; ')||'No formatting changes.'
}

export function planFormat(action, sheetInfo) {
  const range=sheetInfo.usedRange, rows=sheetInfo.rows||[], colCount=sheetInfo.colCount??(range.c2-range.c1+1), rowCount=range.r2-range.r1+1
  const description=describeFormat(action)
  if(typeof action.freezeRows==='number'&&action.freezeRows>=rowCount)return {edits:[],freezeRows:null,widths:[],autoFit:false,result:'OUT_OF_RANGE',description}
  const totals=rows.length>0&&looksLikeTotalsRow(rows.at(-1)), desired=new Map()
  const getDesired=(r,c)=>{const key=`${r}:${c}`;if(!desired.has(key)){const current={...(sheetInfo.getStyle?.(r,c)||{})};desired.set(key,{r,c,current,style:action.clearFormatting?{}:{...current}})}return desired.get(key)}
  const apply=(r1,r2,c1,c2,style)=>{if(!style)return;for(let r=r1;r<=r2;r++)for(let c=c1;c<=c2;c++)Object.assign(getDesired(r,c).style,style)}
  const headerRow=sheetInfo.headerRow??range.r1, bodyStart=Math.max(range.r1,headerRow+1)
  if(action.clearFormatting)for(let r=range.r1;r<=range.r2;r++)for(let c=range.c1;c<=range.c2;c++)getDesired(r,c)
  apply(bodyStart,range.r2,range.c1,range.c2,action.bodyStyle)
  for(const item of action.columns||[]){if(item.col<0||item.col>=colCount)continue;const c=range.c1+item.col;if(c<range.c1||c>range.c2)continue
    if(bodyStart<=range.r2){for(let r=bodyStart;r<=range.r2;r++)Object.assign(getDesired(r,c).style,item.style||{})}
  }
  if(action.totalsStyle&&totals)apply(range.r2,range.r2,range.c1,range.c2,action.totalsStyle)
  if(action.headerStyle){const headerStyle={...action.headerStyle};delete headerStyle.numberFormat;apply(headerRow,headerRow,range.c1,range.c2,headerStyle)}
  const edits=[]
  for(const item of desired.values())if(canonical(item.current)!==canonical(item.style))edits.push({r:item.r,c:item.c,style:Object.keys(item.style).length?item.style:null})

  const requestedWidths=new Map()
  for(const item of action.columnWidths||[])if(item.col>=0&&item.col<colCount&&item.width>=30&&item.width<=600)requestedWidths.set(range.c1+item.col,item.width)
  const autoFit=Boolean(action.autoFitColumns)
  if(autoFit)for(let offset=0;offset<colCount;offset++){
    const c=range.c1+offset;let longest=0
    for(let index=0;index<rows.length;index++){
      const row=rows[index],r=range.r1+index,style=desired.get(`${r}:${c}`)?.style||sheetInfo.getStyle?.(r,c)||{}
      longest=Math.max(longest,formatDisplay(row[offset]??'',style.numberFormat||'general').length)
    }
    requestedWidths.set(c,Math.max(48,Math.min(400,longest*7.5+24)))
  }
  const widths=[...requestedWidths].filter(([col,width])=>width!==(sheetInfo.getColWidth?.(col)??120)).map(([col,width])=>({col,width}))
  const nextFreeze=typeof action.freezeRows==='number'&&action.freezeRows!==(sheetInfo.frozenRows??0)?action.freezeRows:null
  const result=edits.length||widths.length||nextFreeze!==null?'APPLIED':'NO_CHANGES'
  return {edits,freezeRows:nextFreeze,widths,autoFit,result,description}
}

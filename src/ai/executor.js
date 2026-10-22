export const norm = value => String(value ?? '').trim().toLowerCase()
export function toNum(value) {
  const text = String(value ?? '').trim(), percent = text.endsWith('%')
  const cleaned = text.replace(/[$,%\s]/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null
  const number = Number(cleaned)
  return Number.isFinite(number) ? (percent ? number / 100 : number) : null
}
const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 }
export function toDate(value) {
  const text = String(value ?? '').trim()
  let year, month, day, match
  if ((match=text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [,year,month,day]=match
  else if ((match=text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) { [,month,day,year]=match }
  else if ((match=text.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/))) { const monthName=match[2].toLowerCase();if(!Object.keys(MONTHS).some(abbr=>monthName===abbr||monthName===({jan:'january',feb:'february',mar:'march',apr:'april',may:'may',jun:'june',jul:'july',aug:'august',sep:'september',oct:'october',nov:'november',dec:'december'})[abbr]))return null;[,day]=match;month=MONTHS[monthName.slice(0,3)];year=match[3] }
  else return null
  year=Number(year); month=Number(month); day=Number(day)
  const date=new Date(Date.UTC(year,month-1,day))
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return null
  return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
}
const round = value => typeof value === 'number' && Number.isFinite(value) ? Math.round((value + Number.EPSILON) * 100) / 100 : value

export function executeQuery(sheetRows, plan) {
  if (plan?.type !== 'query') return { error: 'READ_ONLY', detail: `Action type ${plan?.type} is not query` }
  const headers = sheetRows[0] || [], lookup = new Map(headers.map((h,i)=>[norm(h),i]))
  const colIndex = name => { const i=lookup.get(norm(name)); if(i===undefined) throw {error:'UNKNOWN_COLUMN',detail:`UNKNOWN_COLUMN:${name}`} ; return i }
  let totals = -1
  for(let r=sheetRows.length-1;r>=1;r--) if(sheetRows[r].some(v=>norm(v))) { if(/^(grand\s+)?(total|totals|subtotal|sum)\b/i.test(String(sheetRows[r].find(v=>norm(v))||'').trim())) totals=r; break }
  const cols = new Map()
  const values = (column) => { if(!cols.has(column)){const index=colIndex(column);cols.set(column,{index,raw:sheetRows.map(row=>row?.[index]??''),norm:sheetRows.map(row=>norm(row?.[index]??'')),num:sheetRows.map(row=>toNum(row?.[index]??'')),date:sheetRows.map(row=>toDate(row?.[index]??''))})}return cols.get(column) }
  try {
    const rows=[]
    for(let r=1;r<sheetRows.length;r++) {
      if(r===totals&&plan.excludeTotalsRow!==false)continue
      if(!(sheetRows[r]||[]).some(v=>norm(v)))continue
      let matches=true
      for(const filter of plan.filters||[]) {
        if(!['eq','neq','gt','gte','lt','lte','contains','startsWith','endsWith','isEmpty','notEmpty'].includes(filter.op)) return {error:'UNKNOWN_OP',detail:`UNKNOWN_OP:${filter.op}`}
        const col=values(filter.column), n=col.norm[r], f=norm(filter.value), a=col.num[r], b=toNum(filter.value)
        let ok
        switch(filter.op){
          case 'eq': case 'neq': {const equal=a!==null&&b!==null?a===b:n===f;ok=filter.op==='eq'?equal:!equal;break}
          case 'gt': case 'gte': case 'lt': case 'lte': {const d=toDate(filter.value);let x,y;if(d){x=col.date[r];y=d}else{x=a;y=b}ok=x!==null&&x!==undefined&&y!==null&&y!==undefined&&(filter.op==='gt'?x>y:filter.op==='gte'?x>=y:filter.op==='lt'?x<y:x<=y);break}
          case 'contains':ok=n.includes(f);break; case 'startsWith':ok=n.startsWith(f);break;case 'endsWith':ok=n.endsWith(f);break;case 'isEmpty':ok=n==='';break;case 'notEmpty':ok=n!=='';break
        }
        if(!ok){matches=false;break}
      }
      if(matches)rows.push(r)
    }
    const groupNames=plan.groupBy||[], aggregates=plan.aggregates||[]
    const groupCols=groupNames.map(values), aggregateCols=aggregates.map(a=>{if(!['sum','avg','count','countDistinct','min','max'].includes(a.fn))throw {error:'UNKNOWN_FN',detail:`UNKNOWN_FN:${a.fn}`};return values(a.column)})
    let output, outputColumns
    if(aggregates.length){
      const groups=new Map()
      for(const r of rows){const key=groupCols.map(col=>col.norm[r]).join('\u0001');if(!groups.has(key))groups.set(key,{labels:groupCols.map(col=>String(col.raw[r]??'').trim()),rows:[]});groups.get(key).rows.push(r)}
      if(!groupCols.length)groups.set('',{labels:[],rows})
      outputColumns=[...groupNames,...aggregates.map(a=>a.as||`${a.fn}(${a.column})`)]
      output=[...groups.values()].map(group=>[...group.labels,...aggregates.map((a,i)=>{const col=aggregateCols[i], rs=group.rows;if(a.fn==='count')return rs.filter(r=>col.norm[r]!=='').length;if(a.fn==='countDistinct')return new Set(rs.map(r=>col.norm[r]).filter(Boolean)).size;const nums=rs.map(r=>col.num[r]).filter(v=>v!==null);if(!nums.length)return null;if(a.fn==='sum')return round(nums.reduce((x,y)=>x+y,0));if(a.fn==='avg')return round(nums.reduce((x,y)=>x+y,0)/nums.length);if(a.fn==='min')return round(Math.min(...nums));return round(Math.max(...nums))})])
    } else {
      const names=plan.columns||headers.map(String); const selected=names.map(values)
      outputColumns=names;output=rows.map(r=>selected.map(col=>col.raw[r]))
    }
    for(const sort of [...(plan.sort||[])].reverse()) {
      const index=outputColumns.findIndex(name=>norm(name)===norm(sort.column));if(index<0)return {error:'UNKNOWN_SORT_COLUMN',detail:`UNKNOWN_SORT_COLUMN:${sort.column}`}
      const dir=sort.dir==='desc'?-1:1
      output=output.map((row,i)=>({row,i})).sort((a,b)=>{const x=a.row[index],y=b.row[index],nx=toNum(x),ny=toNum(y);let cmp;if(nx!==null&&ny!==null)cmp=nx-ny;else if(nx!==null)cmp=-1;else if(ny!==null)cmp=1;else cmp=norm(x).localeCompare(norm(y));return cmp===0?a.i-b.i:cmp*dir}).map(x=>x.row)
    }
    const limit=Math.min(plan.limit??500,500), truncated=output.length>limit
    return {columns:outputColumns,rows:output.slice(0,limit).map(row=>row.map(round)),rowCount:Math.min(output.length,limit),truncated}
  } catch(error) { if(error?.error)return error; throw error }
}

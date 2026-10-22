import { AGGREGATE_FNS, FILTER_OPS, NUMBER_FORMATS } from './contract.js'

const invalid = detail => ({ error: 'INVALID_RESPONSE', detail })
function object(value, path, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return `${path} must be an object`
  for (const key of required) if (!(key in value)) return `${path}.${key} is required`
  for (const key of Object.keys(value)) if (!allowed.includes(key)) return `${path}.${key} is not allowed`
  return null
}
function string(value, path, allowNull = false) { return typeof value === 'string' || (allowNull && value === null) ? null : `${path} must be ${allowNull ? 'a string, number, or null' : 'a string'}` }
function array(value, path) { return Array.isArray(value) ? null : `${path} must be an array` }
function style(value, path) {
  const err = object(value, path, ['bold','italic','underline','bg','color','align','fontSize','numberFormat']); if (err) return err
  for (const key of ['bold','italic','underline']) if (key in value && typeof value[key] !== 'boolean') return `${path}.${key} must be boolean`
  if ('bg' in value && !(value.bg === 'white' || /^#[\da-f]{6}$/i.test(value.bg))) return `${path}.bg is invalid`
  if ('color' in value && !/^#[\da-f]{6}$/i.test(value.color)) return `${path}.color is invalid`
  if ('align' in value && !['left','center','right'].includes(value.align)) return `${path}.align is invalid`
  if ('fontSize' in value && (!Number.isInteger(value.fontSize) || value.fontSize < 8 || value.fontSize > 24)) return `${path}.fontSize must be an integer from 8 to 24`
  if ('numberFormat' in value && !NUMBER_FORMATS.includes(value.numberFormat)) return `${path}.numberFormat is invalid`
  return null
}
export function validateAction(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return invalid('action must be an object')
  if (!['query','clarify','format_sheet'].includes(obj.type)) return { error: 'READ_ONLY', detail: `Action type ${String(obj.type)} is read-only` }
  let err
  if (obj.type === 'clarify') {
    err = object(obj, '$', ['type','question'], ['type','question'])
    if (!err) err = string(obj.question, '$.question')
  } else if (obj.type === 'query') {
    err = object(obj, '$', ['type','excludeTotalsRow','filters','groupBy','aggregates','columns','sort','limit'], ['type'])
    if (!err && 'excludeTotalsRow' in obj && typeof obj.excludeTotalsRow !== 'boolean') err = '$.excludeTotalsRow must be boolean'
    for (const key of ['groupBy','columns']) if (!err && key in obj) { err = array(obj[key], `$.${key}`); if (!err) for (let i=0;i<obj[key].length;i++) { err=string(obj[key][i],`$.${key}[${i}]`); if(err) break } }
    if (!err && 'filters' in obj) { err=array(obj.filters,'$.filters'); if(!err) for(let i=0;i<obj.filters.length;i++){const f=obj.filters[i],p=`$.filters[${i}]`; err=object(f,p,['column','op','value'],['column','op']); if(err)break; err=string(f.column,`${p}.column`); if(err)break; if(!FILTER_OPS.includes(f.op)){err=`${p}.op is invalid`;break} if('value'in f&&!['string','number'].includes(typeof f.value)&&f.value!==null){err=`${p}.value must be string, number, or null`;break} } }
    if (!err && 'aggregates' in obj) { err=array(obj.aggregates,'$.aggregates'); if(!err) for(let i=0;i<obj.aggregates.length;i++){const a=obj.aggregates[i],p=`$.aggregates[${i}]`;err=object(a,p,['fn','column','as'],['fn','column']);if(err)break;if(!AGGREGATE_FNS.includes(a.fn)){err=`${p}.fn is invalid`;break}err=string(a.column,`${p}.column`);if(err)break;if('as'in a){err=string(a.as,`${p}.as`);if(err)break}} }
    if (!err && 'sort' in obj) { err=array(obj.sort,'$.sort');if(!err)for(let i=0;i<obj.sort.length;i++){const s=obj.sort[i],p=`$.sort[${i}]`;err=object(s,p,['column','dir'],['column']);if(err)break;err=string(s.column,`${p}.column`);if(err)break;if('dir'in s&&!['asc','desc'].includes(s.dir)){err=`${p}.dir is invalid`;break}} }
    if (!err && 'limit' in obj && (!Number.isInteger(obj.limit)||obj.limit<1)) err='$.limit must be an integer >= 1'
  } else {
    err=object(obj,'$',['type','clearFormatting','headerStyle','bodyStyle','totalsStyle','columns','freezeRows','columnWidths','autoFitColumns'],['type'])
    for(const key of ['headerStyle','bodyStyle','totalsStyle']) if(!err&&key in obj) err=style(obj[key],`$.${key}`)
    if(!err&&'clearFormatting'in obj&&typeof obj.clearFormatting!=='boolean')err='$.clearFormatting must be boolean'
    if(!err&&'autoFitColumns'in obj&&typeof obj.autoFitColumns!=='boolean')err='$.autoFitColumns must be boolean'
    if(!err&&'freezeRows'in obj&&obj.freezeRows!==null&&(!Number.isInteger(obj.freezeRows)||obj.freezeRows<0))err='$.freezeRows must be a non-negative integer or null'
    for(const key of ['columns','columnWidths']) if(!err&&key in obj){err=array(obj[key],`$.${key}`); if(!err) for(let i=0;i<obj[key].length;i++){const x=obj[key][i],p=`$.${key}[${i}]`;err=object(x,p,key==='columns'?['col','style']:['col','width'],key==='columns'?['col','style']:['col','width']);if(err)break;if(!Number.isInteger(x.col)||x.col<0){err=`${p}.col must be a non-negative integer`;break}if(key==='columns')err=style(x.style,`${p}.style`);else if(!Number.isInteger(x.width)||x.width<30||x.width>600)err=`${p}.width must be an integer from 30 to 600`;if(err)break}}
  }
  if (err) return invalid(err)
  return obj.type === 'format_sheet' ? { error: 'READ_ONLY', detail: 'format_sheet is not executable in the Ask your data panel' } : obj
}

export function describePlan(plan) {
  if (plan.type !== 'query') return plan.type === 'clarify' ? plan.question : 'This action is read-only and will not be applied.'
  const parts=[]
  if(plan.filters?.length)parts.push(`Filter rows where ${plan.filters.map(f=>`${f.column} ${f.op} ${f.value??''}`).join(' and ')}`)
  if(plan.groupBy?.length)parts.push(`Group by ${plan.groupBy.join(', ')}`)
  if(plan.aggregates?.length)parts.push(plan.aggregates.map(a=>`${a.fn} of ${a.column} as ${a.as||`${a.fn}(${a.column})`}`).join(', '))
  if(!parts.length)parts.push('Show rows from the sheet')
  if(plan.sort?.length)parts.push(`sort by ${plan.sort.map(s=>`${s.column} ${s.dir||'asc'}`).join(', ')}`)
  parts.push(`limit to ${Math.min(plan.limit||500,500)} rows`)
  return `${parts.join('; ')}.`
}

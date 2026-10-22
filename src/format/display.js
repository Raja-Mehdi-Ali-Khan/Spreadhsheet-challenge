import { toDate, toNum } from '../ai/executor.js'

const numberFormatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const percentFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, useGrouping: false })

export function formatDisplay(value, numberFormat = 'general') {
  if (value === null || value === undefined || value === '') return ''
  const text = String(value)
  if (numberFormat === 'date') return toDate(text) || text
  if (!['number', 'currency', 'percent'].includes(numberFormat)) return text
  const numeric = toNum(value)
  if (numeric === null) return text
  if (numberFormat === 'number') return numberFormatter.format(numeric)
  if (numberFormat === 'currency') return `$${numberFormatter.format(numeric)}`
  return `${percentFormatter.format(numeric * 100)}%`
}

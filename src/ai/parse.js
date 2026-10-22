export function extractJson(text) {
  const source = String(text ?? '')
  const start = source.indexOf('{')
  if (start < 0) return { error: 'INVALID_RESPONSE', detail: 'No JSON object found' }
  let depth = 0, quoted = false, escaped = false
  for (let i = start; i < source.length; i++) {
    const ch = source[i]
    if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; continue }
    if (ch === '"') quoted = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) {
      try { return JSON.parse(source.slice(start, i + 1)) }
      catch (error) { return { error: 'INVALID_RESPONSE', detail: `JSON parse failed: ${error.message}` } }
    }
  }
  return { error: 'INVALID_RESPONSE', detail: 'JSON object is incomplete' }
}

import { fillSeries } from './fill.js'

// ─────────────────────────────────────────────────────────────
//  Operator precedence for expression parsing
// ─────────────────────────────────────────────────────────────

const OPERATOR_PRECEDENCE = { '+': 1, '-': 1, '*': 2, '/': 2, 'u-': 3 }
const MAX_UNDO_HISTORY = 100

// ─────────────────────────────────────────────────────────────
//  Column / Cell coordinate utilities
// ─────────────────────────────────────────────────────────────

function columnLetterToIndex(columnLetter) {
    let index = 0
    for (let i = 0; i < columnLetter.length; i++) {
        index = index * 26 + (columnLetter.charCodeAt(i) - 64)
    }
    return index - 1
}

function indexToCellKey(row, col) {
    let columnLabel = ''
    let colNumber = col + 1
    while (colNumber > 0) {
        colNumber--
        columnLabel = String.fromCharCode(65 + (colNumber % 26)) + columnLabel
        colNumber = Math.floor(colNumber / 26)
    }
    return columnLabel + (row + 1)
}

function parseCellKey(cellKey) {
    const match = cellKey.match(/^([A-Z]+)(\d+)$/)
    if (!match) return null
    return { row: parseInt(match[2]) - 1, col: columnLetterToIndex(match[1]) }
}

function parsePlainNumber(value) {
    const trimmedValue = value.trim()
    if (!/^[+-]?(?:(?:0|[1-9]\d*)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmedValue)) return null
    return Number(trimmedValue)
}

function parseFormulaNumber(value) {
    const trimmedValue = value.trim()
    if (trimmedValue.endsWith('%')) return null
    const normalized = trimmedValue.replace(/^\$\s*/, '').replaceAll(',', '')
    if (!/^[+-]?(?:(?:0|[1-9]\d*)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) return null
    const number = Number(normalized)
    return Number.isFinite(number) ? number : null
}

// ─────────────────────────────────────────────────────────────
//  Dependency graph (tracks which cells depend on which)
// ─────────────────────────────────────────────────────────────

function createDependencyGraph() {
    const forwardEdges = new Map()
    const reverseEdges = new Map()
    const formulaRanges = new Map()
    const rangesByColumn = new Map()

    function addDependency(cell, dependsOn) {
        if (!forwardEdges.has(cell)) forwardEdges.set(cell, new Set())
        if (!reverseEdges.has(dependsOn)) reverseEdges.set(dependsOn, new Set())
        forwardEdges.get(cell).add(dependsOn)
        reverseEdges.get(dependsOn).add(cell)
    }

    function removeDependencies(cell) {
        const deps = forwardEdges.get(cell)
        if (deps) {
            for (const dep of deps) {
                if (reverseEdges.has(dep)) {
                    reverseEdges.get(dep).delete(cell)
                    if (reverseEdges.get(dep).size === 0) reverseEdges.delete(dep)
                }
            }
            forwardEdges.delete(cell)
        }
        for (const range of formulaRanges.get(cell) || []) {
            for (let col = range.c1; col <= range.c2; col++) {
                const indexed = rangesByColumn.get(col)
                indexed?.delete(range)
                if (indexed?.size === 0) rangesByColumn.delete(col)
            }
        }
        formulaRanges.delete(cell)
    }

    function addRangeDependency(sheetCell, r1, c1, r2, c2) {
        if (!forwardEdges.has(sheetCell)) forwardEdges.set(sheetCell, new Set())
        const range = { sheetCell, r1, c1, r2, c2 }
        if (!formulaRanges.has(sheetCell)) formulaRanges.set(sheetCell, [])
        formulaRanges.get(sheetCell).push(range)
        for (let col = c1; col <= c2; col++) {
            if (!rangesByColumn.has(col)) rangesByColumn.set(col, new Set())
            rangesByColumn.get(col).add(range)
        }
    }

    function coordinate(key) {
        const match = key.match(/^([A-Z]+)(\d+)$/)
        if (!match) return null
        let col = 0
        for (const letter of match[1]) col = col * 26 + letter.charCodeAt(0) - 64
        return { r: Number(match[2]) - 1, c: col - 1 }
    }

    function getDependencies(cell) {
        const dependencies = new Set(forwardEdges.get(cell) || [])
        for (const range of formulaRanges.get(cell) || []) {
            for (const candidate of forwardEdges.keys()) {
                const point = coordinate(candidate)
                if (point && point.r >= range.r1 && point.r <= range.r2 && point.c >= range.c1 && point.c <= range.c2) dependencies.add(candidate)
            }
        }
        return dependencies
    }

    function getDependents(cell) {
        const dependents = new Set(reverseEdges.get(cell) || [])
        const point = coordinate(cell)
        if (point) for (const range of rangesByColumn.get(point.c) || []) {
            if (point.r >= range.r1 && point.r <= range.r2) dependents.add(range.sheetCell)
        }
        return dependents
    }

    function getAllDependentsRecursive(cell, visited = new Set()) {
        const result = new Set()
        const stack = [cell]
        while (stack.length) {
            const current = stack.pop()
            if (visited.has(current)) continue
            visited.add(current)
            for (const dependent of getDependents(current)) if (!result.has(dependent)) {
                result.add(dependent)
                stack.push(dependent)
            }
        }
        return result
    }

    function hasCycle(startCell) {
        const visited = new Set()
        const stack = [...getDependencies(startCell)]
        while (stack.length) {
            const node = stack.pop()
            if (node === startCell) return true
            if (visited.has(node)) continue
            visited.add(node)
            for (const dep of getDependencies(node)) stack.push(dep)
        }
        return false
    }

    function topologicalSort(affectedCells) {
        const inDegree = new Map()
        const queue = []
        const sorted = []

        for (const cell of affectedCells) inDegree.set(cell, 0)
        for (const cell of affectedCells) {
            for (const dep of getDependencies(cell)) {
                if (affectedCells.has(dep)) {
                    inDegree.set(cell, (inDegree.get(cell) || 0) + 1)
                }
            }
        }
        for (const cell of affectedCells) {
            if (inDegree.get(cell) === 0) queue.push(cell)
        }
        for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
            const cell = queue[queueIndex]
            sorted.push(cell)
            for (const dependent of getDependents(cell)) {
                if (affectedCells.has(dependent)) {
                    inDegree.set(dependent, inDegree.get(dependent) - 1)
                    if (inDegree.get(dependent) === 0) queue.push(dependent)
                }
            }
        }
        return sorted
    }

    function clear() {
        forwardEdges.clear()
        reverseEdges.clear()
        formulaRanges.clear()
        rangesByColumn.clear()
    }

    return {
        addDependency,
        addRangeDependency,
        removeDependencies,
        getDependencies,
        getDependents,
        getAllDependentsRecursive,
        hasCycle,
        topologicalSort,
        clear
    }
}

// ─────────────────────────────────────────────────────────────
//  Tokenizer — converts formula string into tokens
// ─────────────────────────────────────────────────────────────

function tokenize(expression) {
    const tokens = []
    let position = 0

    while (position < expression.length) {
        const char = expression[position]

        if (char === ' ') {
            position++
            continue
        }

        if (char === '(' || char === ')') {
            tokens.push({ type: 'paren', value: char })
            position++
            continue
        }

        if ('+-*/,'.includes(char)) {
            tokens.push({ type: 'operator', value: char })
            position++
            continue
        }

        if (char === ':') {
            tokens.push({ type: 'range', value: ':' })
            position++
            continue
        }

        if ((char >= '0' && char <= '9') || char === '.') {
            let numberStr = ''
            while (position < expression.length && ((expression[position] >= '0' && expression[position] <= '9') || expression[position] === '.')) {
                numberStr += expression[position]
                position++
            }
            tokens.push({ type: 'number', value: parseFloat(numberStr) })
            continue
        }

        if ((char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || char === '$') {
            let identifier = ''
            while (position < expression.length && ((expression[position] >= 'A' && expression[position] <= 'Z') || (expression[position] >= 'a' && expression[position] <= 'z') || (expression[position] >= '0' && expression[position] <= '9') || expression[position] === '$')) {
                identifier += expression[position].toUpperCase()
                position++
            }
            const cellMatch = identifier.match(/^\$?([A-Z]+)\$?(\d+)$/)
            if (cellMatch) {
                tokens.push({ type: 'cell', value: cellMatch[1] + cellMatch[2] })
            } else if (identifier.includes('$')) {
                throw new Error(`Invalid cell reference: ${identifier}`)
            } else {
                tokens.push({ type: 'function', value: identifier })
            }
            continue
        }

        throw new Error(`Unexpected character: ${char}`)
    }

    return tokens
}

// ─────────────────────────────────────────────────────────────
//  Parser — converts tokens into an AST using shunting-yard
// ─────────────────────────────────────────────────────────────

function parseTokensToAST(tokens) {
    const outputQueue = []
    const operatorStack = []
    let position = 0

    while (position < tokens.length) {
        const token = tokens[position]

        if (token.type === 'number' || token.type === 'cell') {
            outputQueue.push(token)
            position++
        } else if (token.type === 'function') {
            operatorStack.push(token)
            position++
        } else if (token.type === 'operator') {
            const previousToken = tokens[position - 1]
            const isUnaryMinus = token.value === '-' && (
                !previousToken ||
                previousToken.type === 'operator' ||
                previousToken.type === 'range' ||
                (previousToken.type === 'paren' && previousToken.value === '(')
            )
            const operator = isUnaryMinus ? { ...token, value: 'u-' } : token
            if (!isUnaryMinus) {
                while (
                    operatorStack.length > 0 &&
                    operatorStack[operatorStack.length - 1].type === 'operator' &&
                    OPERATOR_PRECEDENCE[operatorStack[operatorStack.length - 1].value] >= OPERATOR_PRECEDENCE[operator.value]
                ) {
                    outputQueue.push(operatorStack.pop())
                }
            }
            operatorStack.push(operator)
            position++
        } else if (token.type === 'paren' && token.value === '(') {
            operatorStack.push(token)
            position++
        } else if (token.type === 'paren' && token.value === ')') {
            while (operatorStack.length > 0 && operatorStack[operatorStack.length - 1].value !== '(') {
                outputQueue.push(operatorStack.pop())
            }
            if (operatorStack.length > 0 && operatorStack[operatorStack.length - 1].value === '(') {
                operatorStack.pop()
            }
            if (operatorStack.length > 0 && operatorStack[operatorStack.length - 1].type === 'function') {
                const funcToken = operatorStack.pop()
                if (outputQueue.length > 0 && outputQueue[outputQueue.length - 1].type === 'range') {
                    const rangeToken = outputQueue.pop()
                    outputQueue.push({ type: 'function', name: funcToken.value, range: rangeToken })
                } else {
                    outputQueue.push(funcToken)
                }
            }
            position++
        } else if (token.type === 'range') {
            const startCell = outputQueue.pop()
            const endCell = tokens[position + 1]
            if (!startCell || startCell.type !== 'cell' || !endCell || endCell.type !== 'cell') {
                throw new Error('Range must be between two cell references')
            }
            outputQueue.push({ type: 'range', start: startCell.value, end: endCell.value })
            position += 2
        } else {
            position++
        }
    }

    while (operatorStack.length > 0) {
        if (operatorStack[operatorStack.length - 1].value === '(') {
            throw new Error('Mismatched parentheses')
        }
        outputQueue.push(operatorStack.pop())
    }

    return buildASTFromRPN(outputQueue)
}

function buildASTFromRPN(rpnTokens) {
    const stack = []

    for (const token of rpnTokens) {
        if (token.type === 'number' || token.type === 'cell' || token.type === 'range') {
            stack.push(token)
        } else if (token.type === 'operator' && token.value === 'u-') {
            if (stack.length < 1) throw new Error('Invalid expression')
            stack.push({ type: 'unary', operator: token.value, argument: stack.pop() })
        } else if (token.type === 'operator') {
            if (stack.length < 2) throw new Error('Invalid expression')
            const right = stack.pop()
            const left = stack.pop()
            stack.push({ type: 'binary', operator: token.value, left, right })
        } else if (token.type === 'function') {
            if (token.range) {
                stack.push(token)
            } else {
                if (stack.length === 0) throw new Error(`Function ${token.value} requires arguments`)
                const argument = stack.pop()
                if (argument.type === 'range') {
                    stack.push({ type: 'function', name: token.value, range: argument })
                } else {
                    throw new Error(`Function ${token.value} requires a range`)
                }
            }
        }
    }

    if (stack.length !== 1) throw new Error('Invalid expression')
    return stack[0]
}

// ─────────────────────────────────────────────────────────────
//  Evaluator — walks the AST and computes values
// ─────────────────────────────────────────────────────────────

function expandCellRange(startKey, endKey) {
    const startMatch = startKey.match(/^\$?([A-Z]+)\$?(\d+)$/)
    const endMatch = endKey.match(/^\$?([A-Z]+)\$?(\d+)$/)
    if (!startMatch || !endMatch) throw new Error('REF')

    const startCol = columnLetterToIndex(startMatch[1])
    const startRow = parseInt(startMatch[2]) - 1
    const endCol = columnLetterToIndex(endMatch[1])
    const endRow = parseInt(endMatch[2]) - 1

    const cells = []
    for (let r = Math.min(startRow, endRow); r <= Math.max(startRow, endRow); r++) {
        for (let c = Math.min(startCol, endCol); c <= Math.max(startCol, endCol); c++) {
            cells.push(indexToCellKey(r, c))
        }
    }
    return cells
}

function evaluateAST(ast, getCellValue, visited = new Set()) {
    if (!ast) return 0

    if (ast.type === 'number') return ast.value

    if (ast.type === 'cell') {
        const key = ast.value
        if (visited.has(key)) throw new Error('CIRCULAR')
        visited.add(key)
        const rawValue = getCellValue(key, visited)
        if (rawValue === '#CYCLE!') throw new Error('CIRCULAR')
        if (rawValue === '#REF!') throw new Error('REF')
        const value = typeof rawValue === 'string' ? (parseFormulaNumber(rawValue) ?? rawValue) : rawValue
        visited.delete(key)
        return value
    }

    if (ast.type === 'range') throw new Error('VALUE')

    if (ast.type === 'binary') {
        const leftVal = evaluateAST(ast.left, getCellValue, visited)
        const rightVal = evaluateAST(ast.right, getCellValue, visited)
        if (typeof leftVal !== 'number' || typeof rightVal !== 'number') throw new Error('VALUE')
        switch (ast.operator) {
            case '+': return leftVal + rightVal
            case '-': return leftVal - rightVal
            case '*': return leftVal * rightVal
            case '/':
                if (rightVal === 0) throw new Error('VALUE')
                return leftVal / rightVal
            default: throw new Error('VALUE')
        }
    }

    if (ast.type === 'unary') {
        const value = evaluateAST(ast.argument, getCellValue, visited)
        if (typeof value !== 'number') throw new Error('VALUE')
        if (ast.operator === 'u-') return -value
        throw new Error('VALUE')
    }

    if (ast.type === 'function') {
        const rangeCells = expandCellRange(ast.range.start, ast.range.end)
        const values = rangeCells.map(cellKey => {
            if (visited.has(cellKey)) throw new Error('CIRCULAR')
            visited.add(cellKey)
            const value = getCellValue(cellKey, visited)
            visited.delete(cellKey)
            const num = typeof value === 'number' ? value : typeof value === 'string' ? parseFormulaNumber(value) : null
            return num === null ? 0 : num
        })

        switch (ast.name) {
            case 'SUM': return values.reduce((sum, val) => sum + val, 0)
            case 'AVG': return values.length === 0 ? 0 : values.reduce((sum, val) => sum + val, 0) / values.length
            case 'MIN': return values.length === 0 ? 0 : Math.min(...values)
            case 'MAX': return values.length === 0 ? 0 : Math.max(...values)
            default: throw new Error('VALUE')
        }
    }

    throw new Error('VALUE')
}

function evaluateFormula(expression, getCellValue) {
    try {
        if (!expression || expression.trim() === '') return { value: '', error: null }
        if (!expression.startsWith('=')) return { value: expression, error: null }

        const formulaBody = expression.slice(1).trim()
        if (formulaBody === '') return { value: '', error: null }

        const tokens = tokenize(formulaBody)
        const ast = parseTokensToAST(tokens)
        const result = evaluateAST(ast, getCellValue)
        return { value: result, error: null }
    } catch (error) {
        if (error.message === 'CIRCULAR') return { value: null, error: '#CYCLE!' }
        if (error.message === 'REF') return { value: null, error: '#REF!' }
        if (error.message === 'VALUE') return { value: null, error: '#VALUE!' }
        return { value: null, error: '#PARSE!' }
    }
}

// ─────────────────────────────────────────────────────────────
//  Reference shifting (for insert/delete row/col)
// ─────────────────────────────────────────────────────────────

function shiftCellReferences(formula, rowShift, colShift, atIndex, isColumnOperation = false) {
    if (!formula || !formula.startsWith('=')) return formula

    // Shift cell references in formulas when rows/columns are inserted or deleted
    // Note: This function modifies ALL cell references in the formula, including those
    // in ranges. The logic ensures references shift correctly based on the operation type.
    return formula.replace(/(\$?)([A-Z]+)(\$?)(\d+)/gi, (match, colMarker, colLetter, rowMarker, rowStr) => {
        const colIdx = columnLetterToIndex(colLetter.toUpperCase())
        const rowIdx = parseInt(rowStr) - 1
        let newRow = rowIdx
        let newCol = colIdx

        if (isColumnOperation) {
            // For column operations, only shift columns at or after the insertion/deletion point
            if (colIdx >= atIndex) newCol = colIdx + colShift
        } else {
            // For row operations, only shift rows at or after the insertion/deletion point
            if (rowIdx >= atIndex) newRow = rowIdx + rowShift
        }

        // Preserve original reference if shifting would result in invalid coordinates
        // This prevents formulas from breaking when rows/cols are deleted at boundaries
        if (newRow < 0 || newCol < 0) return match
        const shiftedKey = indexToCellKey(newRow, newCol).match(/^([A-Z]+)(\d+)$/)
        return `${colMarker}${shiftedKey[1]}${rowMarker}${shiftedKey[2]}`
    })
}

function extractCellReferences(formula) {
    const references = new Set()
    // Extract cell references using regex
    // Note: This regex matches cell references like A1, B2, AA10, etc.
    // It does NOT extract individual cells from ranges (e.g., A1:A5 only extracts A1 and A5)
    const regex = /\$?([A-Z]+)\$?(\d+)/gi
    let match
    while ((match = regex.exec(formula)) !== null) {
        references.add(`${match[1].toUpperCase()}${match[2]}`)
    }
    return references
}

// ─────────────────────────────────────────────────────────────
//  Main engine factory
// ─────────────────────────────────────────────────────────────

export function createEngine(initialRows = 50, initialCols = 50) {
    let rows = initialRows
    let cols = initialCols
    const cells = new Map()
    const styles = new Map()
    let rowIds = Array.from({ length: rows }, (_, index) => index * 1024)
    const filters = new Map()
    const colWidths = new Map()
    const rowHeights = new Map()
    const DEFAULT_COL_WIDTH = 120
    const DEFAULT_ROW_HEIGHT = 24
    let frozen = { rows: 1, cols: 1 }
    const stats = { lastRecalcCount: 0 }
    const graph = createDependencyGraph()
    const dirtyCells = new Set()
    const computedCache = new Map()
    const undoStack = []
    const redoStack = []
    let batchDepth = 0
    let batchSnapshot = null
    let batchChanged = false

    // Internal generation counter — incremented on every structural mutation.
    // Used by the cache to validate entries and by the engine to track state integrity.
    let _generation = 0
    let layoutVersion = 0
    let usedRangeCacheGeneration = -1
    let cachedUsedRange = null
    let _batchMode = false
    let _batchCallbacks = []
    let totalsCacheGeneration = -1
    let cachedTotalsRow = -1

    // ── Internal helpers ──

    function cellKey(row, col) {
        return indexToCellKey(row, col)
    }

    function cellCoords(key) {
        return parseCellKey(key)
    }

    function isValidCellKey(key) {
        const coords = cellCoords(key)
        return coords && coords.row >= 0 && coords.row < rows && coords.col >= 0 && coords.col < cols
    }

    function updateDependencies(cell, rawFormula) {
        const rangePattern = /\$?([A-Z]+)\$?(\d+)\s*:\s*\$?([A-Z]+)\$?(\d+)/gi
        const rangeSpans = []
        let rangeMatch
        while ((rangeMatch = rangePattern.exec(rawFormula)) !== null) {
            const start = parseCellKey(`${rangeMatch[1].toUpperCase()}${rangeMatch[2]}`)
            const end = parseCellKey(`${rangeMatch[3].toUpperCase()}${rangeMatch[4]}`)
            if (start && end) {
                graph.addRangeDependency(cell, Math.min(start.row, end.row), Math.min(start.col, end.col), Math.max(start.row, end.row), Math.max(start.col, end.col))
                rangeSpans.push([rangeMatch.index, rangePattern.lastIndex])
            }
        }
        const references = extractCellReferences(rawFormula)
        for (const ref of references) {
            // Range endpoints are represented by a range record, not direct edges.
            const refStart = rawFormula.toUpperCase().indexOf(ref)
            if (rangeSpans.some(([start, end]) => refStart >= start && refStart < end)) continue
            if (isValidCellKey(ref)) graph.addDependency(cell, ref)
        }
    }

    function markCellsDirty(cellsToMark) {
        const pending = [...cellsToMark]
        while (pending.length) {
            const cell = pending.pop()
            if (dirtyCells.has(cell)) continue
            dirtyCells.add(cell)
            for (const dependent of graph.getDependents(cell)) pending.push(dependent)
        }
    }

    function markCellDirty(cell) {
        markCellsDirty([cell])
    }

    function markAllCellsDirty() {
        for (const key of cells.keys()) dirtyCells.add(key)
    }

    // ── Value resolution ──

    function resolveCellValue(cellKey, visited = new Set()) {
        if (visited.has(cellKey)) return '#CYCLE!'
        visited.add(cellKey)

        if (computedCache.has(cellKey)) {
            const cached = computedCache.get(cellKey)
            // Validate cache generation — stale entries from a previous generation are discarded
            // Note: _generation is incremented on structural changes, but cache validation
            // must account for cells that may have been invalidated by dependency changes
            if (!dirtyCells.has(cellKey)) {
                visited.delete(cellKey)
                return cached.error || cached.computed
            }
            computedCache.delete(cellKey)
        }

        const cell = cells.get(cellKey)
        if (!cell || !cell.raw) {
            visited.delete(cellKey)
            return 0
        }

        if (!cell.raw.startsWith('=')) {
            const numericValue = parsePlainNumber(cell.raw)
            visited.delete(cellKey)
            return numericValue === null ? cell.raw : numericValue
        }

        const result = evaluateFormula(cell.raw, (key) => resolveCellValue(key, visited))
        visited.delete(cellKey)

        if (result.error) {
            computedCache.set(cellKey, { computed: null, error: result.error, _gen: _generation })
            return result.error
        }

        computedCache.set(cellKey, { computed: result.value, error: null, _gen: _generation })
        return result.value
    }

    // ── Recalculation ──

    function recalculate() {
        if (dirtyCells.size === 0) { stats.lastRecalcCount = 0; return }

        const affected = new Set(dirtyCells)
        const sorted = graph.topologicalSort(affected)
        const sortedSet = new Set(sorted)
        stats.lastRecalcCount = 0
        for (const cell of sorted) {
            if (dirtyCells.has(cell)) {
                dirtyCells.delete(cell)
                computedCache.delete(cell)
                resolveCellValue(cell)
                stats.lastRecalcCount++
            }
        }
        for (const cell of affected) {
            if (!sortedSet.has(cell)) {
                dirtyCells.delete(cell)
                computedCache.set(cell, { computed: null, error: '#CYCLE!' })
                const cellData = cells.get(cell)
                if (cellData) cellData.error = '#CYCLE!'
                stats.lastRecalcCount++
            }
        }

        dirtyCells.clear()

        // Notify batch listeners if in batch mode
        // WARNING: Batch mode is currently unused but may be needed for future features
        if (_batchMode) {
            _batchCallbacks.forEach(cb => cb())
        }
    }

    // ── Core cell operations ──

    function setCellRaw(row, col, raw, markDirty = true) {
        const key = cellKey(row, col)
        graph.removeDependencies(key)
        computedCache.delete(key)

        if (!raw || raw.trim() === '') {
            cells.delete(key)
            if (markDirty && filters.has(col)) layoutVersion++
            if (markDirty) markCellDirty(key)
            return
        }

        if (raw.startsWith('=')) {
            cells.set(key, { raw, computed: null, error: null })
            updateDependencies(key, raw)
        } else {
            cells.set(key, { raw, computed: null, error: null })
        }

        if (markDirty) markCellDirty(key)
        if (markDirty && filters.has(col)) layoutVersion++
    }

    function getCellRaw(row, col) {
        const key = cellKey(row, col)
        const cell = cells.get(key)
        if (!cell) return { raw: '', computed: null, error: null }
        return { ...cell }
    }

    function computeUsedRange() {
        if (usedRangeCacheGeneration === _generation && cachedUsedRange) return { ...cachedUsedRange }
        if (cells.size === 0) {
            cachedUsedRange = { r1: 0, c1: 0, r2: 0, c2: 0 }
            usedRangeCacheGeneration = _generation
            return { ...cachedUsedRange }
        }
        let r1 = Infinity, c1 = Infinity, r2 = -1, c2 = -1
        for (const key of cells.keys()) {
            const coords = cellCoords(key)
            if (!coords) continue
            r1 = Math.min(r1, coords.row); c1 = Math.min(c1, coords.col)
            r2 = Math.max(r2, coords.row); c2 = Math.max(c2, coords.col)
        }
        cachedUsedRange = r2 < 0 ? { r1: 0, c1: 0, r2: 0, c2: 0 } : { r1, c1, r2, c2 }
        usedRangeCacheGeneration = _generation
        return { ...cachedUsedRange }
    }

    // ── Snapshot / Restore (for undo of structural changes) ──

    function cloneFilters(source = filters) {
        return new Map([...source].map(([column, filter]) => [column, {
            ...(filter.values ? { values: [...filter.values] } : {}),
            ...(filter.condition ? { condition: { ...filter.condition } } : {})
        }]))
    }

    function takeSnapshot() {
        // Create a deep copy of all cell data for undo/redo operations
        // Note: This only captures cell data, not the dependency graph or cache
        // The dependency graph is rebuilt from the cell formulas when restoring
        const snapshot = new Map()
        for (const [key, value] of cells.entries()) {
            // Create a shallow copy of the cell object
            // The cell object contains: { raw: string, computed: number|null, error: string|null }
            // Note: computed and error are not persisted in snapshots - they're recalculated on restore
            snapshot.set(key, { ...value })
        }
        return {
            cells: snapshot,
            styles: new Map([...styles].map(([key, style]) => [key, { ...style }])),
            rowIds: [...rowIds],
            filters: cloneFilters(),
            colWidths: new Map(colWidths),
            rowHeights: new Map(rowHeights),
            frozen: { ...frozen },
            rows,
            cols
        }
    }

    function restoreSnapshot(snapshot) {
        const sameMap = (left, right) => left.size === right.size && [...left].every(([key, value]) => right.get(key) === value)
        const layoutChanged = rows !== snapshot.rows || cols !== snapshot.cols ||
            !sameMap(colWidths, snapshot.colWidths || new Map()) || !sameMap(rowHeights, snapshot.rowHeights || new Map()) ||
            JSON.stringify([...filters]) !== JSON.stringify([...(snapshot.filters || new Map())])
        cells.clear()
        for (const [key, value] of snapshot.cells.entries()) {
            cells.set(key, { ...value })
        }
        styles.clear()
        for (const [key, style] of snapshot.styles) styles.set(key, { ...style })
        rowIds = [...snapshot.rowIds]
        filters.clear()
        for (const [column, filter] of snapshot.filters) filters.set(column, { ...filter, values: filter.values ? [...filter.values] : undefined, condition: filter.condition ? { ...filter.condition } : undefined })
        colWidths.clear(); for (const [column, width] of snapshot.colWidths || []) colWidths.set(column, width)
        rowHeights.clear(); for (const [row, height] of snapshot.rowHeights || []) rowHeights.set(row, height)
        frozen = { ...(snapshot.frozen || { rows: 1, cols: 1 }) }
        if (layoutChanged) layoutVersion++
        rows = snapshot.rows
        cols = snapshot.cols
        graph.clear()
        computedCache.clear()
        dirtyCells.clear()
        _generation++
        // Rebuild dependency graph from restored cells
        // Important: This must happen before marking cells dirty to ensure correct dependency tracking
        for (const [key, value] of cells.entries()) {
            if (value.raw && value.raw.startsWith('=')) updateDependencies(key, value.raw)
        }
        markAllCellsDirty()
    }

    // ── Row / Column structural operations ──

    function performInsertRow(atIndex) {
        const snapshot = takeSnapshot()
        cells.clear()
        graph.clear()
        computedCache.clear()
        dirtyCells.clear()
        _generation++

        for (const [key, value] of snapshot.cells.entries()) {
            const coords = cellCoords(key)
            if (!coords) continue
            if (coords.row >= atIndex) {
                const newKey = cellKey(coords.row + 1, coords.col)
                cells.set(newKey, { ...value, raw: shiftCellReferences(value.raw, 1, 0, atIndex) })
            } else {
                cells.set(key, { ...value, raw: shiftCellReferences(value.raw, 1, 0, atIndex) })
            }
        }
        const leftId = atIndex > 0 ? rowIds[atIndex - 1] : null
        const rightId = atIndex < rowIds.length ? rowIds[atIndex] : null
        const insertedId = leftId === null ? rightId - 1024 : rightId === null ? leftId + 1024 : (leftId + rightId) / 2
        const nextStyles = new Map()
        for (const [key, style] of snapshot.styles) {
            const coords = cellCoords(key)
            const row = coords.row >= atIndex ? coords.row + 1 : coords.row
            nextStyles.set(cellKey(row, coords.col), { ...style })
        }
        styles.clear(); for (const [key, style] of nextStyles) styles.set(key, style)
        const nextHeights = new Map()
        for (const [row, height] of rowHeights) nextHeights.set(row >= atIndex ? row + 1 : row, height)
        rowHeights.clear(); for (const [row, height] of nextHeights) rowHeights.set(row, height)
        rowIds.splice(atIndex, 0, insertedId)
        rows++
        layoutVersion++
        for (const [key, value] of cells.entries()) {
            if (value.raw.startsWith('=')) updateDependencies(key, value.raw)
        }
        markAllCellsDirty()
    }

    function performDeleteRow(atIndex) {
        const snapshot = takeSnapshot()
        cells.clear()
        graph.clear()
        computedCache.clear()
        dirtyCells.clear()
        _generation++

        for (const [key, value] of snapshot.cells.entries()) {
            const coords = cellCoords(key)
            if (!coords) continue
            if (coords.row === atIndex) continue
            if (coords.row > atIndex) {
                const newKey = cellKey(coords.row - 1, coords.col)
                cells.set(newKey, { ...value, raw: shiftCellReferences(value.raw, -1, 0, atIndex) })
            } else {
                cells.set(key, { ...value, raw: shiftCellReferences(value.raw, -1, 0, atIndex) })
            }
        }
        const nextStyles = new Map()
        for (const [key, style] of snapshot.styles) {
            const coords = cellCoords(key)
            if (coords.row === atIndex) continue
            const row = coords.row > atIndex ? coords.row - 1 : coords.row
            nextStyles.set(cellKey(row, coords.col), { ...style })
        }
        styles.clear(); for (const [key, style] of nextStyles) styles.set(key, style)
        const nextHeights = new Map()
        for (const [row, height] of rowHeights) {
            if (row === atIndex) continue
            nextHeights.set(row > atIndex ? row - 1 : row, height)
        }
        rowHeights.clear(); for (const [row, height] of nextHeights) rowHeights.set(row, height)
        rowIds.splice(atIndex, 1)
        rows--
        layoutVersion++
        for (const [key, value] of cells.entries()) {
            if (value.raw.startsWith('=')) updateDependencies(key, value.raw)
        }
        markAllCellsDirty()
    }

    function performInsertColumn(atIndex) {
        const snapshot = takeSnapshot()
        cells.clear()
        graph.clear()
        computedCache.clear()
        dirtyCells.clear()
        _generation++

        for (const [key, value] of snapshot.cells.entries()) {
            const coords = cellCoords(key)
            if (!coords) continue
            if (coords.col >= atIndex) {
                const newKey = cellKey(coords.row, coords.col + 1)
                cells.set(newKey, { ...value, raw: shiftCellReferences(value.raw, 0, 1, atIndex, true) })
            } else {
                cells.set(key, { ...value, raw: shiftCellReferences(value.raw, 0, 1, atIndex, true) })
            }
        }
        const nextStyles = new Map()
        for (const [key, style] of snapshot.styles) {
            const coords = cellCoords(key)
            const col = coords.col >= atIndex ? coords.col + 1 : coords.col
            nextStyles.set(cellKey(coords.row, col), { ...style })
        }
        styles.clear(); for (const [key, style] of nextStyles) styles.set(key, style)
        const nextWidths = new Map()
        for (const [column, width] of colWidths) nextWidths.set(column >= atIndex ? column + 1 : column, width)
        colWidths.clear(); for (const [column, width] of nextWidths) colWidths.set(column, width)
        const nextFilters = new Map()
        for (const [column, filter] of filters) nextFilters.set(column >= atIndex ? column + 1 : column, filter)
        filters.clear(); for (const [column, filter] of nextFilters) filters.set(column, filter)
        cols++
        layoutVersion++
        for (const [key, value] of cells.entries()) {
            if (value.raw.startsWith('=')) updateDependencies(key, value.raw)
        }
        markAllCellsDirty()
    }

    function performDeleteColumn(atIndex) {
        const snapshot = takeSnapshot()
        cells.clear()
        graph.clear()
        computedCache.clear()
        dirtyCells.clear()
        _generation++

        for (const [key, value] of snapshot.cells.entries()) {
            const coords = cellCoords(key)
            if (!coords) continue
            if (coords.col === atIndex) continue
            if (coords.col > atIndex) {
                const newKey = cellKey(coords.row, coords.col - 1)
                cells.set(newKey, { ...value, raw: shiftCellReferences(value.raw, 0, -1, atIndex, true) })
            } else {
                cells.set(key, { ...value, raw: shiftCellReferences(value.raw, 0, -1, atIndex, true) })
            }
        }
        const nextStyles = new Map()
        for (const [key, style] of snapshot.styles) {
            const coords = cellCoords(key)
            if (coords.col === atIndex) continue
            const col = coords.col > atIndex ? coords.col - 1 : coords.col
            nextStyles.set(cellKey(coords.row, col), { ...style })
        }
        styles.clear(); for (const [key, style] of nextStyles) styles.set(key, style)
        const nextWidths = new Map()
        for (const [column, width] of colWidths) {
            if (column === atIndex) continue
            nextWidths.set(column > atIndex ? column - 1 : column, width)
        }
        colWidths.clear(); for (const [column, width] of nextWidths) colWidths.set(column, width)
        const nextFilters = new Map()
        for (const [column, filter] of filters) {
            if (column === atIndex) continue
            nextFilters.set(column > atIndex ? column - 1 : column, filter)
        }
        filters.clear(); for (const [column, filter] of nextFilters) filters.set(column, filter)
        cols--
        layoutVersion++
        for (const [key, value] of cells.entries()) {
            if (value.raw.startsWith('=')) updateDependencies(key, value.raw)
        }
        markAllCellsDirty()
    }

    // ── Undo / Redo ──

    function pushToUndoStack(entry) {
        if (batchDepth > 0) { batchChanged = true; return }
        undoStack.push({ ...entry, _gen: _generation })
        if (undoStack.length > MAX_UNDO_HISTORY) undoStack.shift()
        redoStack.length = 0
    }

    function executeSetCell(row, col, value) {
        const previousValue = getCellRaw(row, col).raw
        // Only create undo entry if value actually changed
        // This prevents undo stack pollution with no-op edits
        if (previousValue !== value) {
            pushToUndoStack({ type: 'set', r: row, c: col, oldVal: previousValue, newVal: value })
        }
        setCellRaw(row, col, value)
        _generation++
        recalculate()
    }

    function applyStyleValue(row, col, style) {
        const key = cellKey(row, col)
        if (style === null) styles.delete(key)
        else styles.set(key, { ...style })
    }

    function executeSetStyles(entries, replace = false) {
        if (!Array.isArray(entries)) throw new TypeError('entries must be an array')
        const changesByKey = new Map()
        for (const entry of entries) {
            const style = entry && Object.hasOwn(entry, 'style') ? entry.style : entry?.partialStyle
            if (!entry || !Number.isInteger(entry.r) || !Number.isInteger(entry.c) || (style !== null && (typeof style !== 'object' || Array.isArray(style)))) {
                throw new TypeError('Each style entry must have integer r and c values and a style object')
            }
            const key = cellKey(entry.r, entry.c)
            const oldStyle = changesByKey.has(key) ? changesByKey.get(key).newStyle : (styles.has(key) ? { ...styles.get(key) } : null)
            const newStyle = style === null ? null : replace ? { ...style } : { ...(oldStyle || {}), ...style }
            changesByKey.set(key, { r: entry.r, c: entry.c, oldStyle, newStyle })
        }
        const changes = [...changesByKey.values()].filter(change => JSON.stringify(change.oldStyle) !== JSON.stringify(change.newStyle))
        if (changes.length === 0) return []
        return changes
    }

    function executeSetCells(entries, styleEntries = [], replaceStyles = false) {
        if (!Array.isArray(entries)) throw new TypeError('entries must be an array')

        const changesByKey = new Map()
        for (const entry of entries) {
            if (!entry || !Number.isInteger(entry.r) || !Number.isInteger(entry.c) || typeof entry.value !== 'string') {
                throw new TypeError('Each entry must have integer r and c values and a string value')
            }
            const key = cellKey(entry.r, entry.c)
            const existing = changesByKey.get(key)
            changesByKey.set(key, {
                r: entry.r,
                c: entry.c,
                oldVal: existing ? existing.oldVal : getCellRaw(entry.r, entry.c).raw,
                newVal: entry.value
            })
        }

        const changes = [...changesByKey.values()].filter(change => change.oldVal !== change.newVal)
        const styleChanges = executeSetStyles(styleEntries, replaceStyles)
        if (changes.length === 0 && styleChanges.length === 0) return

        pushToUndoStack({ type: 'batch', cells: changes, styles: styleChanges })
        for (const change of changes) setCellRaw(change.r, change.c, change.newVal, false)
        markCellsDirty(changes.map(change => cellKey(change.r, change.c)))
        if (changes.some(change => filters.has(change.c))) layoutVersion++
        for (const change of styleChanges) applyStyleValue(change.r, change.c, change.newStyle)
        _generation++
        recalculate()
    }

    function executeSetStyle(row, col, partialStyle) {
        executeSetCells([], [{ r: row, c: col, style: partialStyle }])
    }

    function executeSetStylesPublic(entries, replaceStyles = false) {
        executeSetCells([], entries, replaceStyles)
    }

    function executeFillRange(src, dst) {
        function validateRange(range, name) {
            if (
                !range ||
                !Number.isInteger(range.r1) ||
                !Number.isInteger(range.c1) ||
                !Number.isInteger(range.r2) ||
                !Number.isInteger(range.c2) ||
                range.r1 < 0 ||
                range.c1 < 0 ||
                range.r1 > range.r2 ||
                range.c1 > range.c2
            ) {
                throw new TypeError(`${name} must have valid non-negative integer bounds`)
            }
        }

        validateRange(src, 'src')
        validateRange(dst, 'dst')
        if (
            dst.r1 > src.r1 ||
            dst.c1 > src.c1 ||
            dst.r2 < src.r2 ||
            dst.c2 < src.c2
        ) {
            throw new RangeError('dst must contain src')
        }

        const extendsRows = dst.r1 < src.r1 || dst.r2 > src.r2
        const extendsColumns = dst.c1 < src.c1 || dst.c2 > src.c2
        if (!extendsRows && !extendsColumns) return
        if (extendsRows && extendsColumns) throw new RangeError('Fill in one direction at a time')

        const entries = []
        const styleEntries = []
        const copyStyleForFill = (row, col, seedRow, seedCol) => {
            const style = styles.get(cellKey(seedRow, seedCol))
            styleEntries.push({ r: row, c: col, style: style ? { ...style } : null })
        }
        const mod = (value, divisor) => ((value % divisor) + divisor) % divisor
        if (extendsRows) {
            if (dst.c1 !== src.c1 || dst.c2 !== src.c2) throw new RangeError('Vertical fills must preserve the source columns')
            for (let col = src.c1; col <= src.c2; col++) {
                const seeds = []
                for (let row = src.r1; row <= src.r2; row++) seeds.push(getCellRaw(row, col).raw)
                if (dst.r1 < src.r1) {
                    const values = fillSeries(seeds, src.r1 - dst.r1, true)
                    values.forEach((value, index) => {
                        const row = dst.r1 + index
                        entries.push({ r: row, c: col, value })
                        copyStyleForFill(row, col, src.r1 + mod(row - src.r1, src.r2 - src.r1 + 1), col)
                    })
                }
                if (dst.r2 > src.r2) {
                    const values = fillSeries(seeds, dst.r2 - src.r2)
                    values.forEach((value, index) => {
                        const row = src.r2 + index + 1
                        entries.push({ r: row, c: col, value })
                        copyStyleForFill(row, col, src.r1 + mod(row - src.r1, src.r2 - src.r1 + 1), col)
                    })
                }
            }
        } else {
            if (dst.r1 !== src.r1 || dst.r2 !== src.r2) throw new RangeError('Horizontal fills must preserve the source rows')
            for (let row = src.r1; row <= src.r2; row++) {
                const seeds = []
                for (let col = src.c1; col <= src.c2; col++) seeds.push(getCellRaw(row, col).raw)
                if (dst.c1 < src.c1) {
                    const values = fillSeries(seeds, src.c1 - dst.c1, true, 'column')
                    values.forEach((value, index) => {
                        const col = dst.c1 + index
                        entries.push({ r: row, c: col, value })
                        copyStyleForFill(row, col, row, src.c1 + mod(col - src.c1, src.c2 - src.c1 + 1))
                    })
                }
                if (dst.c2 > src.c2) {
                    const values = fillSeries(seeds, dst.c2 - src.c2, false, 'column')
                    values.forEach((value, index) => {
                        const col = src.c2 + index + 1
                        entries.push({ r: row, c: col, value })
                        copyStyleForFill(row, col, row, src.c1 + mod(col - src.c1, src.c2 - src.c1 + 1))
                    })
                }
            }
        }
        executeSetCells(entries, styleEntries, true)
    }

    function normalizeFilterValue(value) {
        const trimmed = String(value ?? '').trim()
        return trimmed ? trimmed.toLocaleLowerCase() : '(blanks)'
    }

    function parseSortDate(value) {
        const text = String(value).trim()
        let year, month, day, match
        if ((match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
            year = Number(match[1]); month = Number(match[2]); day = Number(match[3])
        } else if ((match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) {
            month = Number(match[1]); day = Number(match[2]); year = Number(match[3])
        } else if ((match = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/))) {
            day = Number(match[1]); year = Number(match[3])
            month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(match[2].slice(0, 3).toLowerCase()) + 1
        } else return null
        if (month < 1 || month > 12 || day < 1 || day > 31) return null
        const time = Date.UTC(year, month - 1, day)
        const date = new Date(time)
        return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? time : null
    }

    function parseSortNumber(value) {
        if (typeof value === 'number' && Number.isFinite(value)) return value
        const text = String(value).trim()
        const percent = text.endsWith('%')
        const normalized = text.replace(/^\$\s*/, '').replaceAll(',', '').replace(/%$/, '')
        if (!/^[+-]?(?:(?:0|[1-9]\d*)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) return null
        const number = Number(normalized)
        return Number.isFinite(number) ? (percent ? number / 100 : number) : null
    }

    function compareSortValues(left, right, direction) {
        const leftText = String(left ?? '').trim()
        const rightText = String(right ?? '').trim()
        const leftBlank = leftText === ''
        const rightBlank = rightText === ''
        if (leftBlank || rightBlank) return leftBlank === rightBlank ? 0 : leftBlank ? 1 : -1
        const leftNumber = parseSortNumber(left)
        const rightNumber = parseSortNumber(right)
        const leftDate = leftNumber === null ? parseSortDate(leftText) : null
        const rightDate = rightNumber === null ? parseSortDate(rightText) : null
        const leftKind = leftNumber !== null ? 0 : leftDate !== null ? 1 : 2
        const rightKind = rightNumber !== null ? 0 : rightDate !== null ? 1 : 2
        if (leftKind !== rightKind) return leftKind - rightKind
        const a = leftKind === 0 ? leftNumber : leftKind === 1 ? leftDate : leftText.toLocaleLowerCase()
        const b = rightKind === 0 ? rightNumber : rightKind === 1 ? rightDate : rightText.toLocaleLowerCase()
        const comparison = a < b ? -1 : a > b ? 1 : 0
        return direction === 'desc' ? -comparison : comparison
    }

    function getTotalsRowIndex() {
        if (totalsCacheGeneration === _generation) return cachedTotalsRow
        const used = computeUsedRange()
        if (used.r2 < 1) cachedTotalsRow = -1
        else {
            const last = getCellRaw(used.r2, 0).raw.trim().toLocaleLowerCase()
            cachedTotalsRow = last === 'total' || last === 'totals' || last === 'grand total' ? used.r2 : -1
        }
        totalsCacheGeneration = _generation
        return cachedTotalsRow
    }

    function getFilterRecord(columnIndex) {
        const filter = filters.get(columnIndex)
        return filter ? {
            ...(filter.values ? { values: [...filter.values] } : {}),
            ...(filter.condition ? { condition: { ...filter.condition } } : {})
        } : null
    }

    function isRowHidden(rowIndex) {
        if (rowIndex === 0 || filters.size === 0 || rowIndex === getTotalsRowIndex()) return false
        for (const [columnIndex, filter] of filters) {
            const raw = getCellRaw(rowIndex, columnIndex).raw
            const normalized = normalizeFilterValue(raw)
            if (filter.values && !filter.values.includes(normalized)) return true
            if (filter.condition) {
                const { op, value = '' } = filter.condition
                if (op === 'empty' && raw.trim() !== '') return true
                if (op === 'contains' && String(value).trim() && !raw.trim().toLocaleLowerCase().includes(String(value).trim().toLocaleLowerCase())) return true
                if (op === 'gt' || op === 'lt') {
                    if (!raw.trim()) return true
                    const actualNum = parseSortNumber(raw)
                    const conditionNum = parseSortNumber(value)
                    const actualDate = actualNum === null ? parseSortDate(raw) : null
                    const conditionDate = conditionNum === null ? parseSortDate(value) : null
                    let comparison
                    if (actualNum !== null && conditionNum !== null) comparison = actualNum - conditionNum
                    else if (actualDate !== null && conditionDate !== null) comparison = actualDate - conditionDate
                    else comparison = raw.trim().toLocaleLowerCase().localeCompare(String(value).trim().toLocaleLowerCase())
                    if (op === 'gt' ? comparison <= 0 : comparison >= 0) return true
                }
            }
        }
        return false
    }

    function getDistinctValues(columnIndex) {
        const used = computeUsedRange()
        const seen = new Set()
        const values = []
        let hasBlanks = false
        const totalsRow = getTotalsRowIndex()
        for (let row = 1; row <= used.r2; row++) {
            if (row === totalsRow) continue
            const raw = getCellRaw(row, columnIndex).raw
            if (!raw.trim()) { hasBlanks = true; continue }
            const normalized = normalizeFilterValue(raw)
            if (!seen.has(normalized)) { seen.add(normalized); values.push(raw.trim()) }
        }
        if (hasBlanks) values.push('(Blanks)')
        return values
    }

    function setFilter(columnIndex, filter) {
        if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= cols) throw new RangeError('columnIndex is outside the sheet')
        const oldFilters = cloneFilters()
        if (filter === null) filters.delete(columnIndex)
        else {
            if (!filter || typeof filter !== 'object') throw new TypeError('filter must be an object or null')
            const next = {}
            if (filter.values !== undefined) {
                if (!Array.isArray(filter.values) || filter.values.some(value => typeof value !== 'string')) throw new TypeError('filter.values must be an array of strings')
                next.values = [...new Set(filter.values.map(normalizeFilterValue))]
            }
            if (filter.condition) {
                const { op, value = '' } = filter.condition
                if (!['contains', 'gt', 'lt', 'empty'].includes(op)) throw new TypeError('Unsupported filter condition')
                next.condition = { op, value: String(value) }
            }
            filters.set(columnIndex, next)
        }
        const newFilters = cloneFilters()
        const serialize = map => JSON.stringify([...map].sort(([a], [b]) => a - b))
        if (serialize(oldFilters) !== serialize(newFilters)) { pushToUndoStack({ type: 'filters', oldFilters, newFilters }); layoutVersion++ }
    }

    function clearFilters() {
        if (filters.size === 0) return
        const oldFilters = cloneFilters()
        filters.clear()
        pushToUndoStack({ type: 'filters', oldFilters, newFilters: new Map() })
        layoutVersion++
    }

    function applyFiltersSnapshot(snapshot) {
        filters.clear()
        for (const [column, filter] of snapshot) filters.set(column, { ...filter, values: filter.values ? [...filter.values] : undefined, condition: filter.condition ? { ...filter.condition } : undefined })
        layoutVersion++
    }

    function rewriteFormulaForSort(formula, rowMap, bodyStart, bodyEnd) {
        if (!formula.startsWith('=')) return formula
        return formula.replace(/(\$?)([A-Z]+)(\$?)(\d+)(?::(\$?)([A-Z]+)(\$?)(\d+))?/gi,
            (match, colMark1, col1, rowMark1, row1, colMark2, col2, rowMark2, row2) => {
                const firstRow = Number(row1) - 1
                const secondRow = row2 === undefined ? null : Number(row2) - 1
                if (secondRow !== null && Math.min(firstRow, secondRow) <= bodyStart && Math.max(firstRow, secondRow) >= bodyEnd) return match
                const movedFirst = rowMap.get(firstRow) ?? firstRow
                const first = `${colMark1}${col1}${rowMark1}${movedFirst + 1}`
                if (secondRow === null) return first
                const movedSecond = rowMap.get(secondRow) ?? secondRow
                return `${first}:${colMark2}${col2}${rowMark2}${movedSecond + 1}`
            })
    }

    function isEmptyDataRow(row) {
        for (let col = 0; col < cols; col++) {
            const raw = getCellRaw(row, col).raw.trim()
            if (raw && !raw.startsWith('=')) return false
        }
        return true
    }

    function executeSortRange(block, columnIndex, direction) {
        if (!['asc', 'desc', 'original'].includes(direction)) throw new TypeError('direction must be asc, desc, or original')
        if (!block || !['r1', 'c1', 'r2', 'c2'].every(key => Number.isInteger(block[key])) || block.r1 < 0 || block.c1 < 0 || block.r1 > block.r2 || block.c1 > block.c2 || block.r2 >= rows || block.c2 >= cols) throw new RangeError('block must be a valid sheet range')
        if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= cols) throw new RangeError('sort column is outside the sheet')

        const totalsRow = block.r2 === getTotalsRowIndex() ? block.r2 : -1
        const hasHeader = block.r1 === 0
        const bodyStart = block.r1 + (hasHeader ? 1 : 0)
        const bodyEnd = block.r2 - (totalsRow >= 0 ? 1 : 0)
        if (bodyStart > bodyEnd) return
        const visibleSlots = []
        for (let row = bodyStart; row <= bodyEnd; row++) if (filters.size === 0 || !isRowHidden(row)) visibleSlots.push(row)
        if (visibleSlots.length < 2) return

        const ordered = [...visibleSlots]
        if (direction === 'original') ordered.sort((a, b) => rowIds[a] - rowIds[b])
        else ordered.sort((a, b) => {
            const left = getCellForDisplay(a, columnIndex)
            const right = getCellForDisplay(b, columnIndex)
            const leftValue = left.raw.startsWith('=') ? left.computed : left.raw
            const rightValue = right.raw.startsWith('=') ? right.computed : right.raw
            const comparison = compareSortValues(leftValue, rightValue, direction)
            if (comparison !== 0) return comparison
            const leftEmptyRow = isEmptyDataRow(a)
            const rightEmptyRow = isEmptyDataRow(b)
            if (leftEmptyRow !== rightEmptyRow) return leftEmptyRow ? 1 : -1
            return a - b
        })
        const rowMap = new Map()
        ordered.forEach((sourceRow, index) => rowMap.set(sourceRow, visibleSlots[index]))
        if ([...rowMap].every(([sourceRow, targetRow]) => sourceRow === targetRow)) return

        const snapshot = batchDepth > 0 ? null : takeSnapshot()
        pushToUndoStack({ type: 'snapshot', snap: snapshot })
        const nextCells = new Map()
        for (const [key, cell] of cells) {
            const coords = cellCoords(key)
            const targetRow = rowMap.get(coords.row) ?? coords.row
            nextCells.set(cellKey(targetRow, coords.col), { ...cell })
        }
        cells.clear()
        for (const [key, cell] of nextCells) cells.set(key, cell)

        const nextStyles = new Map()
        for (const [key, style] of styles) {
            const coords = cellCoords(key)
            const targetRow = rowMap.get(coords.row) ?? coords.row
            nextStyles.set(cellKey(targetRow, coords.col), { ...style })
        }
        styles.clear(); for (const [key, style] of nextStyles) styles.set(key, style)
        const nextRowIds = [...rowIds]
        for (const [sourceRow, targetRow] of rowMap) nextRowIds[targetRow] = rowIds[sourceRow]
        rowIds = nextRowIds
        const nextHeights = new Map()
        for (const [sourceRow, height] of rowHeights) nextHeights.set(rowMap.get(sourceRow) ?? sourceRow, height)
        rowHeights.clear(); for (const [row, height] of nextHeights) rowHeights.set(row, height)
        if (rowHeights.size > 0) layoutVersion++

        for (const cell of cells.values()) {
            if (cell.raw.startsWith('=')) cell.raw = rewriteFormulaForSort(cell.raw, rowMap, bodyStart, bodyEnd)
        }
        graph.clear(); computedCache.clear(); dirtyCells.clear()
        for (const [key, cell] of cells) if (cell.raw.startsWith('=')) updateDependencies(key, cell.raw)
        _generation++
        for (const [key, cell] of cells) if (cell.raw.startsWith('=')) dirtyCells.add(key)
        recalculate()
    }

    function executeInsertRow(atIndex) {
        const snapshot = takeSnapshot()
        const previousRows = rows
        pushToUndoStack({ type: 'rowins', snap: snapshot, oldRows: previousRows })
        performInsertRow(atIndex)
        recalculate()
    }

    function executeDeleteRow(atIndex) {
        const snapshot = takeSnapshot()
        const previousRows = rows
        pushToUndoStack({ type: 'rowdel', snap: snapshot, oldRows: previousRows })
        performDeleteRow(atIndex)
        recalculate()
    }

    function executeInsertColumn(atIndex) {
        const snapshot = takeSnapshot()
        const previousCols = cols
        pushToUndoStack({ type: 'colins', snap: snapshot, oldCols: previousCols })
        performInsertColumn(atIndex)
        recalculate()
    }

    function executeDeleteColumn(atIndex) {
        const snapshot = takeSnapshot()
        const previousCols = cols
        pushToUndoStack({ type: 'coldel', snap: snapshot, oldCols: previousCols })
        performDeleteColumn(atIndex)
        recalculate()
    }

    function setColWidth(columnIndex, width) {
        if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= cols || !Number.isFinite(width) || width < 24) throw new RangeError('Invalid column width')
        const previous = colWidths.get(columnIndex) ?? DEFAULT_COL_WIDTH
        if (previous === width) return
        const snapshot = batchDepth > 0 ? null : takeSnapshot()
        pushToUndoStack({ type: 'snapshot', snap: snapshot })
        if (width === DEFAULT_COL_WIDTH) colWidths.delete(columnIndex)
        else colWidths.set(columnIndex, width)
        layoutVersion++
    }

    function setRowHeight(rowIndex, height) {
        if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= rows || !Number.isFinite(height) || height < 12) throw new RangeError('Invalid row height')
        const previous = rowHeights.get(rowIndex) ?? DEFAULT_ROW_HEIGHT
        if (previous === height) return
        const snapshot = batchDepth > 0 ? null : takeSnapshot()
        pushToUndoStack({ type: 'snapshot', snap: snapshot })
        if (height === DEFAULT_ROW_HEIGHT) rowHeights.delete(rowIndex)
        else rowHeights.set(rowIndex, height)
        layoutVersion++
    }

    function setFrozen(value) {
        if (!value || !Number.isInteger(value.rows) || !Number.isInteger(value.cols) || value.rows < 0 || value.cols < 0) throw new TypeError('frozen must contain non-negative integer rows and cols')
        if (frozen.rows === value.rows && frozen.cols === value.cols) return
        const snapshot = batchDepth > 0 ? null : takeSnapshot()
        pushToUndoStack({ type: 'snapshot', snap: snapshot })
        frozen = { rows: Math.min(rows, value.rows), cols: Math.min(cols, value.cols) }
    }

    function batch(fn) {
        if (typeof fn !== 'function') throw new TypeError('batch expects a function')
        if (batchDepth > 0) return fn()
        batchSnapshot = takeSnapshot()
        batchChanged = false
        batchDepth = 1
        let result
        try {
            result = fn()
        } catch (error) {
            batchDepth = 0
            restoreSnapshot(batchSnapshot)
            batchSnapshot = null
            batchChanged = false
            throw error
        }
        batchDepth = 0
        const snapshot = batchSnapshot
        batchSnapshot = null
        if (batchChanged) pushToUndoStack({ type: 'snapshot', snap: snapshot })
        batchChanged = false
        return result
    }

    function undo() {
        if (undoStack.length === 0) return false
        const entry = undoStack.pop()

        if (entry.type === 'set') {
            // For cell edits, swap current value to redo stack and restore old value
            const currentValue = getCellRaw(entry.r, entry.c).raw
            redoStack.push({ ...entry, newVal: currentValue })
            setCellRaw(entry.r, entry.c, entry.oldVal)
            _generation++
            recalculate()
        } else if (entry.type === 'batch') {
            redoStack.push({
                ...entry,
                cells: entry.cells.map(change => ({
                    ...change,
                    newVal: getCellRaw(change.r, change.c).raw
                })),
                styles: (entry.styles || []).map(change => ({
                    ...change,
                    newStyle: styles.has(cellKey(change.r, change.c)) ? { ...styles.get(cellKey(change.r, change.c)) } : null
                }))
            })
            for (const change of entry.cells) setCellRaw(change.r, change.c, change.oldVal, false)
            markCellsDirty(entry.cells.map(change => cellKey(change.r, change.c)))
            if (entry.cells.some(change => filters.has(change.c))) layoutVersion++
            for (const change of entry.styles || []) applyStyleValue(change.r, change.c, change.oldStyle)
            _generation++
            recalculate()
        } else if (entry.type === 'filters') {
            const currentFilters = cloneFilters()
            redoStack.push({ type: 'filters', oldFilters: cloneFilters(entry.oldFilters), newFilters: currentFilters })
            applyFiltersSnapshot(entry.oldFilters)
        } else if (entry.type === 'snapshot') {
            redoStack.push({ ...entry, restoreSnap: takeSnapshot(), restoreRows: rows, restoreCols: cols })
            restoreSnapshot(entry.snap)
            recalculate()
        } else {
            // For structural changes (row/col insert/delete), save current state to redo
            // and restore the snapshot from undo entry
            // Note: The snapshot contains the cell data, but rows/cols must be restored separately
            redoStack.push({
                ...entry,
                restoreSnap: takeSnapshot(),
                restoreRows: rows,
                restoreCols: cols
            })
            restoreSnapshot(entry.snap)
            // Restore grid dimensions - this must happen after restoreSnapshot
            // because restoreSnapshot increments _generation but doesn't modify rows/cols
            if (entry.type === 'rowins' || entry.type === 'rowdel') rows = entry.oldRows
            else if (entry.type === 'colins' || entry.type === 'coldel') cols = entry.oldCols
            recalculate()
        }
        return true
    }

    function redo() {
        if (redoStack.length === 0) return false
        const entry = redoStack.pop()

        if (entry.type === 'set') {
            const currentValue = getCellRaw(entry.r, entry.c).raw
            undoStack.push({ ...entry, oldVal: currentValue })
            setCellRaw(entry.r, entry.c, entry.newVal)
            _generation++
            recalculate()
        } else if (entry.type === 'batch') {
            undoStack.push({
                ...entry,
                cells: entry.cells.map(change => ({
                    ...change,
                    oldVal: getCellRaw(change.r, change.c).raw
                })),
                styles: (entry.styles || []).map(change => ({
                    ...change,
                    oldStyle: styles.has(cellKey(change.r, change.c)) ? { ...styles.get(cellKey(change.r, change.c)) } : null
                }))
            })
            for (const change of entry.cells) setCellRaw(change.r, change.c, change.newVal, false)
            markCellsDirty(entry.cells.map(change => cellKey(change.r, change.c)))
            if (entry.cells.some(change => filters.has(change.c))) layoutVersion++
            for (const change of entry.styles || []) applyStyleValue(change.r, change.c, change.newStyle)
            _generation++
            recalculate()
        } else if (entry.type === 'filters') {
            const currentFilters = cloneFilters()
            undoStack.push({ type: 'filters', oldFilters: currentFilters, newFilters: cloneFilters(entry.newFilters) })
            applyFiltersSnapshot(entry.newFilters)
        } else if (entry.type === 'snapshot') {
            undoStack.push({ ...entry, snap: takeSnapshot(), oldRows: rows, oldCols: cols })
            restoreSnapshot(entry.restoreSnap)
            recalculate()
        } else {
            undoStack.push({
                ...entry,
                snap: takeSnapshot(),
                oldRows: rows,
                oldCols: cols
            })
            restoreSnapshot(entry.restoreSnap)
            rows = entry.restoreRows
            cols = entry.restoreCols
            recalculate()
        }
        return true
    }

    // ── Public cell display (returns raw + computed + error) ──

    function getCellForDisplay(row, col) {
        const cell = getCellRaw(row, col)
        if (!cell.raw) return { raw: '', computed: '', error: null }
        const key = cellKey(row, col)
        // Resolve the computed value (this may trigger recalculation if the cell is dirty)
        // The resolveCellValue function handles caching and dependency resolution
        const value = resolveCellValue(key)

        // Error values are strings starting with '#' (e.g., '#CYCLE!', '#VALUE!')
        if (typeof value === 'string' && value.startsWith('#')) {
            return { raw: cell.raw, computed: null, error: value }
        }
        // Return the computed value (which may be a number or string)
        // Note: Empty cells return '' as computed value, not null
        return { raw: cell.raw, computed: value, error: null }
    }

    // ── Public API ──
    // The engine exposes a limited API to prevent direct access to internal state
    // All cell operations go through the public methods which handle undo/redo,
    // dependency tracking, and cache invalidation automatically

    return {
        get rows() { return rows },
        get cols() { return cols },
        getCell: getCellForDisplay,
        getUsedRange: computeUsedRange,
        setCell: executeSetCell,
        setCells: executeSetCells,
        fillRange: executeFillRange,
        setStyle: executeSetStyle,
        setStyles: executeSetStylesPublic,
        batch,
        getStyle: (row, col) => styles.has(cellKey(row, col)) ? { ...styles.get(cellKey(row, col)) } : {},
        getColWidth: column => colWidths.get(column) ?? DEFAULT_COL_WIDTH,
        setColWidth,
        getRowHeight: row => isRowHidden(row) ? 0 : rowHeights.get(row) ?? DEFAULT_ROW_HEIGHT,
        setRowHeight,
        getFrozen: () => ({ ...frozen }),
        getLayoutVersion: () => layoutVersion,
        setFrozen,
        stats,
        sortRange: executeSortRange,
        setFilter,
        clearFilters,
        isRowHidden,
        getVisibleRowCount: () => {
            const used = computeUsedRange()
            const totalsRow = getTotalsRowIndex()
            let count = 0
            for (let row = 1; row <= used.r2; row++) {
                if (row !== totalsRow && !isRowHidden(row)) count++
            }
            return count
        },
        getDistinctValues,
        getFilter: getFilterRecord,
        getFilters: () => cloneFilters(),
        hasActiveFilters: () => filters.size > 0,
        insertRow: executeInsertRow,
        deleteRow: executeDeleteRow,
        insertColumn: executeInsertColumn,
        deleteColumn: executeDeleteColumn,
        undo,
        redo,
        canUndo: () => undoStack.length > 0,
        canRedo: () => redoStack.length > 0,
        // Grow the grid so that at least minRows x minCols exist. The engine is
        // sparse, so this only moves the bounds; nothing is allocated.
        ensureCapacity: (minRows, minCols) => {
            let changed = false
            if (minRows > rows) {
                while (rowIds.length < minRows) rowIds.push((rowIds.at(-1) ?? -1024) + 1024)
                rows = minRows
                changed = true
            }
            if (minCols > cols) { cols = minCols; changed = true }
            if (changed) layoutVersion++
        },
        // Internal state is not exposed - if you need to serialize/deserialize,
        // you'll need to work with the public API or add new methods
    }
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function parseDate(value) {
    let match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    let format
    let year
    let month
    let day

    if (match) {
        format = { type: 'iso', monthWidth: 2, dayWidth: 2 }
        year = Number(match[1])
        month = Number(match[2])
        day = Number(match[3])
    } else {
        match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
        if (!match) return null
        format = { type: 'slash', monthWidth: match[1].length, dayWidth: match[2].length }
        month = Number(match[1])
        day = Number(match[2])
        year = Number(match[3])
    }

    const date = new Date(0)
    date.setUTCHours(0, 0, 0, 0)
    date.setUTCFullYear(year, month - 1, day)
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
    return { time: date.getTime(), format }
}

function formatDate(time, format) {
    const date = new Date(time)
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(format.monthWidth, '0')
    const day = String(date.getUTCDate()).padStart(format.dayWidth, '0')
    return format.type === 'iso'
        ? `${year}-${month}-${day}`
        : `${month}/${day}/${String(year).padStart(4, '0')}`
}

function applyCase(value, template) {
    if (template === template.toUpperCase()) return value.toUpperCase()
    if (template === template.toLowerCase()) return value.toLowerCase()
    if (template[0] === template[0].toUpperCase() && template.slice(1) === template.slice(1).toLowerCase()) {
        return value[0].toUpperCase() + value.slice(1).toLowerCase()
    }
    return value
}

function getNameInfo(value, names) {
    const normalized = value.toLowerCase()
    const name = names.find(entry => entry.toLowerCase() === normalized || entry.slice(0, 3).toLowerCase() === normalized)
    if (!name) return null
    const abbreviated = normalized.length === 3
    return { index: names.indexOf(name), abbreviated }
}

function formatName(names, index, abbreviated, template) {
    const name = names[index]
    return applyCase(abbreviated ? name.slice(0, 3) : name, template)
}

function inferCyclicStep(first, second, length) {
    let step = second - first
    if (step > length / 2) step -= length
    if (step < -length / 2) step += length
    return step
}

function parseNumeric(value) {
    if (!/^[+-]?(?:(?:0|[1-9]\d*)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return null
    if (/^[+-]?0\d+$/.test(value.trim())) return null
    return Number(value.trim())
}

function parseSuffix(value) {
    const match = value.match(/^(.*?)(\d+)$/)
    return match ? { prefix: match[1], digits: match[2], value: Number(match[2]) } : null
}

function formatSuffix(prefix, value, width) {
    const sign = value < 0 ? '-' : ''
    return `${prefix}${sign}${String(Math.abs(value)).padStart(width, '0')}`
}

function cellOffset(rowOffset, columnOffset) {
    return (formula) => formula.replace(/(\$?)([A-Z]+)(\$?)(\d+)/gi, (match, columnMarker, column, rowMarker, row) => {
        const columnIndex = column.toUpperCase().split('').reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1
        const rowIndex = Number(row) - 1
        const nextColumn = columnIndex + (columnMarker ? 0 : columnOffset)
        const nextRow = rowIndex + (rowMarker ? 0 : rowOffset)
        if (nextColumn < 0 || nextRow < 0) return match

        let columnLabel = ''
        let value = nextColumn + 1
        while (value > 0) {
            value--
            columnLabel = String.fromCharCode(65 + (value % 26)) + columnLabel
            value = Math.floor(value / 26)
        }
        return `${columnMarker}${columnLabel}${rowMarker}${nextRow + 1}`
    })
}

function inferFormulaStep(first, second, axis) {
    const references = formula => [...formula.matchAll(/(\$?)([A-Z]+)(\$?)(\d+)/gi)]
    const firstReferences = references(first)
    const secondReferences = references(second)
    if (firstReferences.length !== secondReferences.length || firstReferences.length === 0) {
        return axis === 'row' ? [1, 0] : [0, 1]
    }

    let rowStep = null
    let columnStep = null
    for (let index = 0; index < firstReferences.length; index++) {
        const a = firstReferences[index]
        const b = secondReferences[index]
        const columnIndex = reference => reference[2].toUpperCase().split('').reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1
        const currentRow = Number(a[4]) - 1
        const nextRow = Number(b[4]) - 1
        const currentColumn = columnIndex(a)
        const nextColumn = columnIndex(b)
        if (!a[1] && !b[1]) {
            const difference = nextColumn - currentColumn
            if (columnStep !== null && columnStep !== difference) return axis === 'row' ? [1, 0] : [0, 1]
            columnStep = difference
        }
        if (!a[3] && !b[3]) {
            const difference = nextRow - currentRow
            if (rowStep !== null && rowStep !== difference) return axis === 'row' ? [1, 0] : [0, 1]
            rowStep = difference
        }
    }

    return [rowStep ?? (axis === 'row' ? 1 : 0), columnStep ?? (axis === 'column' ? 1 : 0)]
}

export function fillSeries(seedValues, count, backwards = false, axis = 'row') {
    if (!Array.isArray(seedValues) || seedValues.length === 0 || seedValues.some(value => typeof value !== 'string')) {
        throw new TypeError('seedValues must be a non-empty array of strings')
    }
    if (!Number.isInteger(count) || count < 0) throw new RangeError('count must be a non-negative integer')
    if (axis !== 'row' && axis !== 'column') throw new RangeError('axis must be row or column')
    if (count === 0) return []

    if (seedValues.every(value => value.startsWith('='))) {
        const anchorIndex = backwards ? 0 : seedValues.length - 1
        const anchor = seedValues[anchorIndex]
        const step = seedValues.length > 1
            ? inferFormulaStep(seedValues[backwards ? 0 : seedValues.length - 2], seedValues[backwards ? 1 : seedValues.length - 1], axis)
            : axis === 'row' ? [1, 0] : [0, 1]
        const offsets = backwards
            ? Array.from({ length: count }, (_, index) => index - count)
            : Array.from({ length: count }, (_, index) => index + 1)
        return offsets.map(offset => cellOffset(step[0] * offset, step[1] * offset)(anchor))
    }

    const parsedDates = seedValues.map(parseDate)
    if (parsedDates.every(Boolean)) {
        if (seedValues.length === 1) return Array(count).fill(seedValues[0])
        const dayMilliseconds = 86400000
        const step = (parsedDates.at(-1).time - parsedDates.at(-2).time) / dayMilliseconds
        if (!Number.isInteger(step)) return Array(count).fill(seedValues.at(-1))
        const anchorIndex = backwards ? 0 : seedValues.length - 1
        const anchor = parsedDates[anchorIndex]
        const offsets = backwards
            ? Array.from({ length: count }, (_, index) => index - count)
            : Array.from({ length: count }, (_, index) => index + 1)
        return offsets.map((offset, index) => {
            const format = parsedDates[index % parsedDates.length].format
            return formatDate(anchor.time + step * offset * dayMilliseconds, format)
        })
    }

    for (const names of [WEEKDAYS, MONTHS]) {
        const nameInfos = seedValues.map(value => getNameInfo(value, names))
        if (nameInfos.every(Boolean) && nameInfos.every(info => info.abbreviated === nameInfos[0].abbreviated)) {
            const step = nameInfos.length > 1
                ? inferCyclicStep(nameInfos.at(-2).index, nameInfos.at(-1).index, names.length)
                : 1
            const anchorIndex = backwards ? 0 : seedValues.length - 1
            const anchor = nameInfos[anchorIndex]
            const offsets = backwards
                ? Array.from({ length: count }, (_, index) => index - count)
                : Array.from({ length: count }, (_, index) => index + 1)
            return offsets.map(offset => formatName(
                names,
                (anchor.index + step * offset + names.length * (count + 1)) % names.length,
                anchor.abbreviated,
                seedValues[anchorIndex]
            ))
        }
    }

    const numericValues = seedValues.map(parseNumeric)
    if (numericValues.every(value => value !== null)) {
        if (seedValues.length === 1) return Array(count).fill(seedValues[0])
        const step = numericValues.at(-1) - numericValues.at(-2)
        const decimals = Math.max(...seedValues.map(value => (value.split('.')[1] || '').split(/[eE]/)[0].length))
        const anchor = backwards ? numericValues[0] : numericValues.at(-1)
        const offsets = backwards
            ? Array.from({ length: count }, (_, index) => index - count)
            : Array.from({ length: count }, (_, index) => index + 1)
        return offsets.map(offset => {
            const value = (anchor + step * offset).toFixed(decimals)
            return decimals > 0 ? value.replace(/\.?0+$/, '') : value
        })
    }

    const suffixes = seedValues.map(parseSuffix)
    if (suffixes.every(Boolean) && suffixes.every(value => value.prefix === suffixes[0].prefix)) {
        const step = suffixes.length > 1
            ? suffixes.at(-1).value - suffixes.at(-2).value
            : 1
        const anchorIndex = backwards ? 0 : suffixes.length - 1
        const anchor = suffixes[anchorIndex]
        const offsets = backwards
            ? Array.from({ length: count }, (_, index) => index - count)
            : Array.from({ length: count }, (_, index) => index + 1)
        const width = Math.max(...suffixes.map(value => value.digits.length))
        return offsets.map(offset => formatSuffix(anchor.prefix, anchor.value + step * offset, width))
    }

    if (seedValues.length === 1) return Array(count).fill(seedValues[0])
    return Array.from({ length: count }, (_, index) => seedValues[index % seedValues.length])
}

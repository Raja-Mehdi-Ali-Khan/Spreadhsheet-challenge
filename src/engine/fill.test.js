import { describe, expect, it } from 'vitest'
import { fillSeries } from './fill.js'

describe('fillSeries', () => {
    it('increments numbered text and preserves zero padding', () => {
        expect(fillSeries(['ORD-1001', 'ORD-1002'], 3)).toEqual([
            'ORD-1003',
            'ORD-1004',
            'ORD-1005'
        ])
        expect(fillSeries(['Item 001'], 1)).toEqual(['Item 002'])
        expect(fillSeries(['Q4'], 1)).toEqual(['Q5'])
        expect(fillSeries(['2024-W01'], 1)).toEqual(['2024-W02'])
    })

    it('steps date seeds by days and preserves both supported formats', () => {
        expect(fillSeries(['2024-01-15', '2024-01-16'], 2)).toEqual([
            '2024-01-17',
            '2024-01-18'
        ])
        expect(fillSeries(['1/15/2024', '1/16/2024'], 2)).toEqual([
            '1/17/2024',
            '1/18/2024'
        ])
    })

    it('cycles weekday and month names with their original case and abbreviation', () => {
        expect(fillSeries(['Mon'], 1)).toEqual(['Tue'])
        expect(fillSeries(['Monday'], 1)).toEqual(['Tuesday'])
        expect(fillSeries(['Jan'], 1)).toEqual(['Feb'])
        expect(fillSeries(['January'], 1)).toEqual(['February'])
        expect(fillSeries(['MON'], 1)).toEqual(['TUE'])
    })

    it('shifts formula references while preserving absolute row and column markers', () => {
        expect(fillSeries(['=G2*H2'], 1)).toEqual(['=G3*H3'])
        expect(fillSeries(['=$G$2*H2'], 1)).toEqual(['=$G$2*H3'])
        expect(fillSeries(['=$G2*H$2'], 1)).toEqual(['=$G3*H$2'])
        expect(fillSeries(['=G2*H2'], 1, false, 'column')).toEqual(['=H2*I2'])
    })

    it('continues series backwards and copies a single ordinary seed', () => {
        expect(fillSeries(['ORD-1001', 'ORD-1002'], 2, true)).toEqual([
            'ORD-0999',
            'ORD-1000'
        ])
        expect(fillSeries(['Mon'], 2, true)).toEqual(['Sat', 'Sun'])
        expect(fillSeries(['hello'], 2)).toEqual(['hello', 'hello'])
        expect(fillSeries(['1', '2'], 2)).toEqual(['3', '4'])
    })
})

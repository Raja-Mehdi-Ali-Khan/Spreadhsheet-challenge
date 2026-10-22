import { describe, expect, it } from 'vitest'
import { formatDisplay } from './display.js'

describe('formatDisplay',()=>{
  it('follows every value in the AI contract display table',()=>{
    const cases=[
      ['79','number','79.00'],['$1,200.00','number','1,200.00'],['0.1','number','0.10'],['10%','number','0.10'],['n/a','number','n/a'],
      ['79','currency','$79.00'],['$1,200.00','currency','$1,200.00'],['0.1','currency','$0.10'],['10%','currency','$0.10'],['n/a','currency','n/a'],
      ['79','percent','7900%'],['$1,200.00','percent','120000%'],['0.1','percent','10%'],['10%','percent','10%'],['n/a','percent','n/a'],
      ['2024-01-15','date','2024-01-15'],['1/15/2024','date','2024-01-15'],['15 Jan 2024','date','2024-01-15'],['n/a','date','n/a'],
      ['$1,200.00','general','$1,200.00'],['','currency','']
    ]
    for(const [value,format,expected] of cases)expect(formatDisplay(value,format),`${value} as ${format}`).toBe(expected)
  })
})

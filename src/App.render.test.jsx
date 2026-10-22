import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import App from './App.jsx'

describe('App render smoke test', () => {
    it('renders the spreadsheet grid without a browser DOM', () => {
        const markup = renderToStaticMarkup(<App />)
        expect(markup).toContain('Spreadsheet App')
        expect(markup).toContain('class="grid-scroll"')
        expect(markup).toContain('aria-label="Fill handle"')
    })
})

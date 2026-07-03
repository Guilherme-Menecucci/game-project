// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { VictoryBanner } from '../components/game/VictoryBanner'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null

function render(ui: React.ReactElement): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(ui))
  return container
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('VictoryBanner', () => {
  it('renders nothing while not visible', () => {
    const container = render(<VictoryBanner visible={false} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows the victory headline once visible', () => {
    const container = render(<VictoryBanner visible={true} />)
    expect(container.textContent).toContain('VICTORY!')
  })

  it('self-dismisses after 4 seconds', () => {
    const container = render(<VictoryBanner visible={true} />)
    act(() => {
      vi.advanceTimersByTime(3999)
    })
    expect(container.textContent).toContain('VICTORY!')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(container.innerHTML).toBe('')
  })
})

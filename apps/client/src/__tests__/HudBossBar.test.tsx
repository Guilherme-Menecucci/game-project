// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { HudBossBar } from '../components/game/HudBossBar'

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

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

// The fill element is the innermost div: cluster > track > fill.
function fillEl(container: HTMLElement): HTMLElement {
  return container.querySelectorAll('div')[2] as HTMLElement
}

describe('HudBossBar', () => {
  it('renders the boss name', () => {
    const container = render(<HudBossBar name="The Unfinished One" hp={100} maxHp={100} />)
    expect(container.textContent).toContain('The Unfinished One')
  })

  it('fills the full 320px track at max hp', () => {
    const container = render(<HudBossBar name="Boss" hp={100} maxHp={100} />)
    expect(fillEl(container).style.width).toBe('320px')
  })

  it('scales fill width proportionally to hp', () => {
    const container = render(<HudBossBar name="Boss" hp={50} maxHp={100} />)
    expect(fillEl(container).style.width).toBe('160px')
  })

  it('renders an empty bar at zero hp', () => {
    const container = render(<HudBossBar name="Boss" hp={0} maxHp={100} />)
    expect(fillEl(container).style.width).toBe('0px')
  })

  it('guards division by zero when maxHp is 0', () => {
    const container = render(<HudBossBar name="Boss" hp={10} maxHp={0} />)
    expect(fillEl(container).style.width).toBe('0px')
  })
})

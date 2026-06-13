/**
 * UniformGrid — spatial hash grid for O(n) collision broadphase (GAME-18).
 *
 * World uses integer sub-units: 1000 sub-units per game unit.
 * Cell size: 64 game units × 1000 sub-units = 64,000 sub-units.
 * World: 4096 × 1000 = 4,096,000 sub-units in each dimension.
 * Grid dimensions: 64 × 64 cells.
 *
 * queryRadius uses toroidal arithmetic to handle world-wrap correctly.
 */

export const CELL_SIZE = 64_000 // 64 game units × 1000 sub-units
export const WORLD_W = 4_096_000 // 4096 game units × 1000 sub-units
export const WORLD_H = 4_096_000

const COLS = Math.ceil(WORLD_W / CELL_SIZE) // 64
const ROWS = Math.ceil(WORLD_H / CELL_SIZE) // 64

type CellEntry = { x: number; y: number }

export class UniformGrid {
  private cells: Map<number, Map<string, CellEntry>> = new Map()

  private cellKey(cx: number, cy: number): number {
    return cx * COLS + cy
  }

  insert(id: string, x: number, y: number): void {
    const cx = Math.floor(x / CELL_SIZE) % COLS
    const cy = Math.floor(y / CELL_SIZE) % ROWS
    const key = this.cellKey(cx, cy)
    let cell = this.cells.get(key)
    if (cell === undefined) {
      cell = new Map()
      this.cells.set(key, cell)
    }
    cell.set(id, { x, y })
  }

  queryRadius(cx: number, cy: number, r: number): string[] {
    const result: string[] = []
    const halfW = WORLD_W / 2
    const halfH = WORLD_H / 2
    const rSq = r * r

    // Compute cell range to check
    const cellR = Math.ceil(r / CELL_SIZE) + 1

    const baseCellX = Math.floor(cx / CELL_SIZE)
    const baseCellY = Math.floor(cy / CELL_SIZE)

    for (let dx = -cellR; dx <= cellR; dx++) {
      for (let dy = -cellR; dy <= cellR; dy++) {
        const ncx = (((baseCellX + dx) % COLS) + COLS) % COLS
        const ncy = (((baseCellY + dy) % ROWS) + ROWS) % ROWS
        const key = this.cellKey(ncx, ncy)
        const cell = this.cells.get(key)
        if (cell === undefined) continue

        for (const [id, entry] of cell) {
          // Toroidal distance
          let adx = Math.abs(entry.x - cx)
          if (adx > halfW) adx = WORLD_W - adx
          let ady = Math.abs(entry.y - cy)
          if (ady > halfH) ady = WORLD_H - ady

          if (adx * adx + ady * ady <= rSq) {
            result.push(id)
          }
        }
      }
    }

    return result
  }

  clear(): void {
    this.cells.clear()
  }
}

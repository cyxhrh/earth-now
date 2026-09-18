import {
  calloutCapacity,
  cardEdge,
  contains,
  layoutCallouts,
  overlaps,
  type Anchor,
  type Callout,
  type Point,
  type Rect,
} from './markerLayout'

export interface MovingCallout extends Callout {
  anchor: Point
  opacity: number
  interactive: boolean
}
interface Entry {
  card: MovingCallout
  offset: Point
  invalidSince?: number
}
interface Frame {
  now: number
  anchors: Anchor[]
  bounds: Rect
  obstacles: Rect[]
  size: { width: number; height: number }
  moving?: boolean
  reflow?: boolean
  priority?: string
  reducedMotion?: boolean
}

/** Packing is a discrete decision; projection is continuous. Never repack on a camera frame. */
export class CalloutMotion {
  private entries = new Map<string, Entry>()
  private seen = new Map<string, number>()
  private initialized = false
  private lastTime = 0
  private nextFill = 0
  private reflowAt = Infinity

  update({
    now,
    anchors,
    bounds,
    obstacles,
    size,
    moving = false,
    reflow = false,
    priority,
    reducedMotion = false,
  }: Frame): MovingCallout[] {
    const dt = Math.min(50, Math.max(0, now - this.lastTime))
    this.lastTime = now
    const points = new Map(anchors.map((anchor) => [anchor.id, anchor]))
    for (const id of this.seen.keys()) if (!points.has(id)) this.seen.delete(id)
    for (const anchor of anchors) if (!this.seen.has(anchor.id)) this.seen.set(anchor.id, now)
    if (moving || reflow) this.reflowAt = now + 300
    const repack = !this.initialized || (!moving && now >= this.reflowAt)
    const add = (layout: Callout[]) => {
      for (const card of layout) {
        const anchor = points.get(card.id)!
        const existing = this.entries.get(card.id)
        const offset = { x: card.x - anchor.x, y: card.y - anchor.y }
        if (existing) {
          existing.offset = offset
          existing.invalidSince = undefined
          existing.card.slot = card.slot
          existing.card.width = card.width
          existing.card.height = card.height
        } else {
          this.entries.set(card.id, {
            offset,
            card: { ...card, anchor, opacity: reducedMotion ? 1 : 0, interactive: false },
          })
        }
      }
    }
    if (repack) {
      const layout = layoutCallouts(
        anchors,
        bounds,
        obstacles,
        size,
        new Map([...this.entries].map(([id, entry]) => [id, entry.card.slot])),
        priority,
      )
      const retained = new Set(layout.map((card) => card.id))
      // Retire in place. Removed cards fade before their space can be reused.
      for (const [id, entry] of this.entries) if (!retained.has(id)) entry.invalidSince = now
      add(layout)
      this.initialized = true
      this.reflowAt = Infinity
      this.nextFill = now + 800
    }

    const occupied: Rect[] = []
    const output: MovingCallout[] = []
    for (const [id, entry] of this.entries) {
      const anchor = points.get(id)
      const card = entry.card
      if (anchor) {
        const x = Math.max(
          bounds.x,
          Math.min(bounds.x + bounds.width - card.width, anchor.x + entry.offset.x),
        )
        const y = Math.max(
          bounds.y,
          Math.min(bounds.y + bounds.height - card.height, anchor.y + entry.offset.y),
        )
        // Follow projection without lag. Only deliberate offset changes ease into place.
        const dx = anchor.x - card.anchor.x
        const dy = anchor.y - card.anchor.y
        const follow = reducedMotion ? 1 : 1 - Math.exp(-dt / 85)
        card.x += dx
        card.y += dy
        card.x += (x - card.x) * follow
        card.y += (y - card.y) * follow
        card.anchor = anchor
        card.end = cardEdge(card, anchor)
      }
      const valid =
        !!anchor &&
        contains(bounds, anchor, -16) &&
        card.width <= bounds.width &&
        card.height <= bounds.height &&
        !contains(card, anchor, 16) &&
        !obstacles.some((rect) => overlaps(card, rect, 12)) &&
        !occupied.some((rect) => overlaps(card, rect, 12)) &&
        Math.hypot(card.end.x - anchor.x, card.end.y - anchor.y) <= 240
      if (!valid) {
        entry.invalidSince ??= now
      }
      const show = valid && entry.invalidSince === undefined
      // Once retiring, finish fading; don't bounce on and off at the globe's rim.
      card.interactive = show
      card.opacity = reducedMotion
        ? Number(show)
        : Math.max(0, Math.min(1, card.opacity + (show ? dt / 220 : -dt / 180)))
      if (card.opacity > 0 || show) occupied.push(card)
      output.push({ ...card, anchor: { ...card.anchor }, end: { ...card.end } })
      if (entry.invalidSince !== undefined && card.opacity === 0 && now - entry.invalidSince >= 500)
        this.entries.delete(id)
    }

    // Auto rotation only fills vacancies. Existing cards never swap sides to fit another card.
    if (!moving && !repack && now >= this.nextFill && this.reflowAt === Infinity) {
      this.nextFill = now + 800
      const candidates = anchors.filter(
        (anchor) => !this.entries.has(anchor.id) && now - this.seen.get(anchor.id)! >= 600,
      )
      const free = Math.max(0, calloutCapacity(bounds, size) - this.entries.size)
      add(
        layoutCallouts(
          candidates,
          bounds,
          [...obstacles, ...occupied],
          size,
          new Map(),
          priority,
        ).slice(0, free),
      )
    }
    return output
  }
}

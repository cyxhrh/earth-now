import type { NewsItem } from '../news/model'
import { getMapAnchor, type MapAnchor } from '../news/mapAnchor'

export interface RegionNews {
  id: string
  location: NonNullable<NewsItem['location']>
  items: NewsItem[]
  anchor: MapAnchor
}
export interface Point {
  x: number
  y: number
}
export interface Rect extends Point {
  width: number
  height: number
}
export interface Anchor extends Point {
  id: string
  editorialPriority?: number
  size?: { width: number; height: number }
}
export interface Callout extends Rect {
  id: string
  slot: number
  end: Point
}

export function groupRegions(
  items: NewsItem[],
  expanded = false,
  maxPerLocation = expanded ? 3 : 1,
): RegionNews[] {
  const groups = new Map<string, RegionNews>()
  for (const item of items) {
    const anchor = getMapAnchor(item)
    if (!anchor) continue
    const { name, lat, lng, precision } = anchor.location
    const id = JSON.stringify([name, lat, lng, precision, anchor.kind, anchor.organization])
    const group = groups.get(id)
    if (group) group.items.push(item)
    else groups.set(id, { id, location: anchor.location, items: [item], anchor })
  }
  const located = [...groups.values()].flatMap((group) => {
    if (maxPerLocation <= 1 || group.items.length < 2) return [group]
    // Stable buckets expose up to three reports from a dense region without moving its coordinates.
    const buckets: NewsItem[][] = Array.from(
      { length: Math.min(maxPerLocation, group.items.length) },
      () => [],
    )
    group.items.forEach((item, index) => buckets[index % buckets.length]!.push(item))
    return buckets.map((entries, index) => ({
      ...group,
      id: `${group.id}:${index}`,
      items: entries,
    }))
  })
  return located
}

export function contains(rect: Rect, point: Point, margin = 0) {
  return (
    point.x >= rect.x - margin &&
    point.x <= rect.x + rect.width + margin &&
    point.y >= rect.y - margin &&
    point.y <= rect.y + rect.height + margin
  )
}

export function overlaps(a: Rect, b: Rect, gap = 0) {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  )
}

// A surface point is visible only if its outward normal faces the camera.
// Using the camera position (rather than longitude) also works at the poles.
export function facesCamera(point: { x: number; y: number; z: number }, camera: typeof point) {
  return (
    point.x * (camera.x - point.x) +
      point.y * (camera.y - point.y) +
      point.z * (camera.z - point.z) >
    0
  )
}

export function cardEdge(card: Rect, anchor: Point): Point {
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
  const choices = [
    { x: card.x, y: clamp(anchor.y, card.y + 16, card.y + card.height - 16) },
    { x: card.x + card.width, y: clamp(anchor.y, card.y + 16, card.y + card.height - 16) },
    { x: clamp(anchor.x, card.x + 16, card.x + card.width - 16), y: card.y },
    { x: clamp(anchor.x, card.x + 16, card.x + card.width - 16), y: card.y + card.height },
  ]
  return choices.sort(
    (a, b) =>
      Math.hypot(a.x - anchor.x, a.y - anchor.y) - Math.hypot(b.x - anchor.x, b.y - anchor.y),
  )[0]!
}

function crosses(a: Point, b: Point, c: Point, d: Point) {
  const side = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
}

function cutsCard(a: Point, b: Point, card: Rect) {
  const tl = { x: card.x, y: card.y }
  const tr = { x: card.x + card.width, y: card.y }
  const bl = { x: card.x, y: card.y + card.height }
  const br = { x: tr.x, y: bl.y }
  return (
    contains(card, a) ||
    contains(card, b) ||
    [
      [tl, tr],
      [tr, br],
      [br, bl],
      [bl, tl],
    ].some(([c, d]) => crosses(a, b, c!, d!))
  )
}

/** Reserve at least half the usable map area for the globe and its controls. */
export function calloutCapacity(bounds: Rect, size: { width: number; height: number }) {
  if (bounds.width < size.width || bounds.height < size.height) return 0
  const areaBudget = Math.floor((bounds.width * bounds.height * 0.5) / (size.width * size.height))
  const screenLimit = bounds.width < 430 ? 2 : bounds.width < 850 ? 6 : bounds.width < 1100 ? 8 : 10
  return Math.max(0, Math.min(screenLimit, areaBudget))
}

/** Try short, anchor-relative callouts before falling back to another direction. */
export function layoutCallouts(
  anchors: Anchor[],
  bounds: Rect,
  obstacles: Rect[],
  size: { width: number; height: number },
  previous: Map<string, number> = new Map(),
  priority?: string,
): Callout[] {
  if (bounds.width < size.width || bounds.height < size.height) return []
  const maxCards = calloutCapacity(bounds, size)
  const ordered = [...anchors].sort(
    (a, b) =>
      Number(b.id === priority) - Number(a.id === priority) ||
      (b.editorialPriority ?? 0) - (a.editorialPriority ?? 0) ||
      Number(previous.has(b.id)) - Number(previous.has(a.id)),
  )
  const pack = (order: Anchor[]) => {
    const result: Callout[] = []
    for (const anchor of order) {
      if (result.length >= maxCards) break
      const cardSize = anchor.size ?? size
      const { width, height } = cardSize
      const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
      // More nearby alternatives let crowded regions spread into free space.
      // The order stays fixed, so a saved slot remains stable during rotation.
      const offsets = [38, 88, 144].flatMap((gap) => [
        [gap, -height + 28],
        [-width - gap, -height + 28],
        [gap, 28],
        [-width - gap, 28],
        [-width / 2, -height - gap],
        [-width / 2, gap],
        [gap, -height / 2],
        [-width - gap, -height / 2],
      ])
      const candidates = offsets.flatMap(([dx, dy], slot) => {
        const card = {
          x: clamp(anchor.x + dx!, bounds.x, bounds.x + bounds.width - width),
          y: clamp(anchor.y + dy!, bounds.y, bounds.y + bounds.height - height),
          ...cardSize,
        }
        if (
          contains(card, anchor, 24) ||
          obstacles.some((rect) => overlaps(card, rect, 12)) ||
          result.some((rect) => overlaps(card, rect, 16))
        )
          return []
        // Never hide another displayed card's anchor or cut through its leader.
        if (
          result.some((placed) => {
            const source = anchors.find((point) => point.id === placed.id)!
            return contains(card, source, 20) || cutsCard(source, placed.end, card)
          })
        )
          return []
        const end = cardEdge(card, anchor)
        if (
          result.some((rect) => cutsCard(anchor, end, rect)) ||
          obstacles.some((rect) => cutsCard(anchor, end, rect))
        )
          return []
        const intersections = result.filter((placed) =>
          crosses(
            anchor,
            end,
            anchors.find((point) => point.id === placed.id)!,
            placed.end,
          ),
        ).length
        const distance = Math.hypot(end.x - anchor.x, end.y - anchor.y)
        // Prefer empty space near this region over a long leader across the globe.
        if (distance > 220) return []
        const coveredPins = anchors.filter(
          (other) => other.id !== anchor.id && contains(card, other, 12),
        ).length
        const cost =
          distance +
          intersections * 500 +
          coveredPins * 85 -
          (previous.get(anchor.id) === slot ? 34 : 0)
        return [{ card: { ...card, id: anchor.id, slot, end }, cost }]
      })
      candidates.sort((a, b) => a.cost - b.cost)
      if (candidates[0]) result.push(candidates[0].card)
    }
    return result
  }
  let best = pack(ordered)
  const score = (cards: Callout[]) =>
    cards.reduce(
      (total, card) =>
        total +
        1 +
        (anchors.find((anchor) => anchor.id === card.id)?.editorialPriority ?? 0) +
        (card.id === priority ? 1e9 : 0),
      0,
    )
  // A greedy first card can block several nearby regions. Try a few spatial
  // orders without trading away pictured / higher-ranked stories for density.
  if (best.length < maxCards) {
    const alternatives = [
      [...anchors].sort((a, b) => a.y - b.y),
      [...anchors].sort((a, b) => b.y - a.y),
      [...anchors].sort((a, b) => a.x - b.x),
      [...anchors].sort((a, b) => b.x - a.x),
    ]
    for (const order of alternatives) {
      order.sort((a, b) => Number(b.id === priority) - Number(a.id === priority))
      const candidate = pack(order)
      if (score(candidate) > score(best)) best = candidate
      if (best.length === maxCards) break
    }
  }
  return best
}

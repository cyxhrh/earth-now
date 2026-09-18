import { describe, expect, it } from 'vitest'
import {
  calloutCapacity,
  contains,
  facesCamera,
  groupRegions,
  layoutCallouts,
  overlaps,
} from './markerLayout'
import type { NewsItem } from '../news/model'

describe('region news callouts', () => {
  it('can expose two world reports from one country without adding unlocated pins', () => {
    const location = { name: '巴西', lat: -14, lng: -52, precision: 'country' as const }
    const items = [
      { id: 'one', location },
      { id: 'two', location },
      { id: 'unknown', location: null },
    ] as NewsItem[]
    const groups = groupRegions(items, false, 2)
    expect(groups).toHaveLength(2)
    expect(
      groups.every((group) => group.location === location && group.anchor.kind === 'reported'),
    ).toBe(true)
  })
  it('expands focused coverage without fabricating coordinates or losing grouped stories', () => {
    const location = { name: '中国', lat: 35, lng: 105, precision: 'country' as const }
    const items = Array.from({ length: 7 }, (_, i) => ({ id: String(i), location })) as NewsItem[]
    const expanded = groupRegions([...items, { id: 'remote', location: null } as NewsItem], true)
    expect(expanded.filter((group) => group.location)).toHaveLength(3)
    expect(expanded.flatMap((group) => group.items.map((item) => item.id)).sort()).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ])
    expect(expanded.some((group) => group.items.some((item) => item.id === 'remote'))).toBe(false)
    expect(
      expanded.filter((group) => group.location).every((group) => group.location === location),
    ).toBe(true)
  })
  it('packs compact text and illustrated cards by their actual dimensions', () => {
    const bounds = { x: 0, y: 0, width: 1200, height: 900 }
    const anchors = Array.from({ length: 8 }, (_, i) => ({
      id: String(i),
      x: i % 2 ? 850 : 350,
      y: 140 + Math.floor(i / 2) * 200,
      size: { width: 184, height: i % 2 ? 174 : 122 },
    }))
    const cards = layoutCallouts(anchors, bounds, [], { width: 184, height: 174 })
    expect(cards.length).toBeGreaterThanOrEqual(6)
    for (const card of cards) {
      expect(card.height).toBe(anchors.find((anchor) => anchor.id === card.id)!.size.height)
      expect(contains(bounds, { x: card.x + card.width, y: card.y + card.height })).toBe(true)
      expect(cards.some((other) => other.id !== card.id && overlaps(card, other, 12))).toBe(false)
    }
  })
  it('prefers a pictured card when several regions compete for a single slot', () => {
    const anchors = [
      { id: 'text', x: 100, y: 220, editorialPriority: 0 },
      { id: 'photo', x: 105, y: 225, editorialPriority: 1001 },
    ]
    const bounds = { x: 12, y: 100, width: 336, height: 350 }
    const size = { width: 148, height: 220 }
    expect(layoutCallouts(anchors, bounds, [], size).map((card) => card.id)).toEqual(['photo'])
    expect(
      layoutCallouts(anchors, bounds, [], size, new Map(), 'text').map((card) => card.id),
    ).toEqual(['text'])
  })
  it('groups only identical geographic locations and keeps all their articles', () => {
    const location = { name: '德国', lat: 51, lng: 10, precision: 'country' as const }
    const items = [
      { id: 'a', location },
      { id: 'b', location },
      { id: 'c', location: { ...location, name: '柏林', precision: 'city' } },
      { id: 'd', location: null },
    ] as NewsItem[]
    expect(groupRegions(items).map((group) => group.items.map((item) => item.id))).toEqual([
      ['a', 'b'],
      ['c'],
    ])
  })

  it('hides the far hemisphere and the occluded rim, including at the poles', () => {
    expect(facesCamera({ x: 0, y: 0, z: 100 }, { x: 0, y: 0, z: 240 })).toBe(true)
    expect(facesCamera({ x: 0, y: 0, z: -100 }, { x: 0, y: 0, z: 240 })).toBe(false)
    expect(facesCamera({ x: 100, y: 0, z: 0 }, { x: 0, y: 0, z: 240 })).toBe(false)
    expect(facesCamera({ x: 0, y: 100, z: 0 }, { x: 0, y: 240, z: 0 })).toBe(true)
  })

  it('keeps cards inside the center panel, clear of the toolbar and each other', () => {
    const bounds = { x: 300, y: 200, width: 630, height: 540 }
    const toolbar = { x: 877, y: 500, width: 53, height: 170 }
    const anchors = Array.from({ length: 12 }, (_, i) => ({
      id: String(i),
      x: 510 + i * 9,
      y: 310 + i * 22,
    }))
    const cards = layoutCallouts(anchors, bounds, [toolbar], { width: 168, height: 210 })
    expect(cards.length).toBeGreaterThan(0)
    expect(cards.length).toBeLessThanOrEqual(calloutCapacity(bounds, { width: 168, height: 210 }))
    for (const card of cards) {
      expect(contains(bounds, card)).toBe(true)
      expect(contains(bounds, { x: card.x + card.width, y: card.y + card.height })).toBe(true)
      expect(overlaps(card, toolbar, 12)).toBe(false)
      const anchor = anchors.find((point) => point.id === card.id)!
      expect(Math.hypot(card.end.x - anchor.x, card.end.y - anchor.y)).toBeLessThanOrEqual(220)
      expect(
        contains(
          card,
          anchors.find((a) => a.id === card.id)!,
          24,
        ),
      ).toBe(false)
      expect(cards.some((other) => other.id !== card.id && overlaps(card, other, 16))).toBe(false)
    }
  })

  it('prioritizes a clicked region in a narrow viewport', () => {
    const anchors = [
      { id: 'old', x: 220, y: 200 },
      { id: 'clicked', x: 250, y: 240 },
    ]
    const cards = layoutCallouts(
      anchors,
      { x: 12, y: 100, width: 330, height: 350 },
      [],
      { width: 144, height: 200 },
      new Map([['old', 0]]),
      'clicked',
    )
    expect(cards[0]?.id).toBe('clicked')
    expect(cards.length).toBeLessThanOrEqual(2)
  })

  it('keeps a valid slot stable during small camera movements and yields when too short', () => {
    const bounds = { x: 300, y: 200, width: 630, height: 540 }
    const first = layoutCallouts([{ id: 'a', x: 620, y: 430 }], bounds, [], {
      width: 168,
      height: 210,
    })
    const next = layoutCallouts(
      [{ id: 'a', x: 624, y: 434 }],
      bounds,
      [],
      { width: 168, height: 210 },
      new Map(first.map((card) => [card.id, card.slot])),
    )
    expect(next[0]?.slot).toBe(first[0]?.slot)
    expect(
      layoutCallouts([{ id: 'a', x: 620, y: 430 }], { ...bounds, height: 100 }, [], {
        width: 168,
        height: 210,
      }),
    ).toEqual([])
  })

  it('can put the single mobile card on the right when its anchor occupies the left rail', () => {
    const cards = layoutCallouts(
      [{ id: 'a', x: 80, y: 220 }],
      { x: 12, y: 100, width: 336, height: 350 },
      [],
      { width: 148, height: 220 },
    )
    expect(cards).toHaveLength(1)
    expect(cards[0]!.x).toBeGreaterThan(80 + 24)
    expect(Math.hypot(cards[0]!.end.x - 80, cards[0]!.end.y - 220)).toBeLessThan(100)
  })

  it('scales the density budget while preserving at least half of the usable map', () => {
    for (const [width, height, cardWidth, expected] of [
      [366, 371, 156, 2],
      [647, 551, 184, 5],
      [1164, 764, 184, 10],
    ]) {
      const size = { width: cardWidth!, height: 174 }
      const bounds = { x: 0, y: 0, width: width!, height: height! }
      const count = calloutCapacity(bounds, size)
      expect(count).toBe(expected)
      expect(count * size.width * size.height).toBeLessThanOrEqual(width! * height! * 0.5)
    }
  })

  it('actually places more than the old four-card limit in a spacious view', () => {
    const anchors = Array.from({ length: 8 }, (_, i) => ({
      id: String(i),
      x: 220 + (i % 4) * 280,
      y: 260 + Math.floor(i / 4) * 340,
    }))
    const cards = layoutCallouts(anchors, { x: 0, y: 0, width: 1300, height: 860 }, [], {
      width: 184,
      height: 174,
    })
    expect(cards.length).toBeGreaterThanOrEqual(7)
    for (const card of cards) {
      expect(cards.some((other) => other.id !== card.id && overlaps(card, other, 16))).toBe(false)
    }
  })
})

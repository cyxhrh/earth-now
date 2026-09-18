import { expect, it } from 'vitest'
import { CalloutMotion } from './markerMotion'

const bounds = { x: 305, y: 219, width: 647, height: 551 }
const size = { width: 184, height: 174 }
const points = [
  [449, 360],
  [398, 438],
  [792, 582],
  [410, 487],
  [423, 518],
  [561, 496],
  [677, 450],
  [473, 460],
  [457, 374],
]

it.each([false, true])(
  'does not teleport a card while projected locations move continuously (dragging=%s)',
  (moving) => {
    const motion = new CalloutMotion()
    let positions = new Map<string, { x: number; y: number }>()
    let maxJump = 0
    for (let tick = 0; tick < 240; tick++) {
      const anchors = points.map(([x, y], i) => ({
        id: String(i),
        x: x! + tick * 0.5,
        y: y! + Math.sin(tick / 60) * 12,
      }))
      const cards = motion.update({ now: tick * 16, anchors, bounds, obstacles: [], size, moving })
      for (const card of cards) {
        const old = positions.get(card.id)
        if (old) maxJump = Math.max(maxJump, Math.hypot(card.x - old.x, card.y - old.y))
      }
      positions = new Map(cards.map((card) => [card.id, card]))
    }
    expect(maxJump).toBeLessThan(8)
  },
)

const field = { x: 0, y: 0, width: 1200, height: 800 }
const first = { id: 'first', x: 300, y: 300 }
const second = { id: 'second', x: 850, y: 500 }
const base = { bounds: field, size, obstacles: [] }

it('reflows a failed image into a shorter card while retaining its geographic anchor', () => {
  const motion = new CalloutMotion()
  const anchor = { ...first, size }
  motion.update({ ...base, now: 0, anchors: [anchor], reducedMotion: true })
  const compact = { ...anchor, size: { ...size, height: 122 } }
  motion.update({ ...base, now: 100, anchors: [compact], reflow: true, reducedMotion: true })
  const cards = motion.update({ ...base, now: 450, anchors: [compact], reducedMotion: true })
  expect(cards[0].height).toBe(122)
  expect(cards[0].interactive).toBe(true)
})

it('locks membership during drag and waits 300 ms before admitting newly exposed news', () => {
  const motion = new CalloutMotion()
  motion.update({ ...base, now: 0, anchors: [first] })
  for (let now = 16; now <= 1600; now += 16) {
    const cards = motion.update({ ...base, now, anchors: [first, second], moving: true })
    expect(cards.map((card) => card.id)).toEqual(['first'])
  }
  expect(
    motion.update({ ...base, now: 1899, anchors: [first, second] }).map((card) => card.id),
  ).toEqual(['first'])
  expect(
    motion.update({ ...base, now: 1900, anchors: [first, second] }).map((card) => card.id),
  ).toContain('second')
})

it('fades a backside card and does not resurrect it on a one-frame boundary bounce', () => {
  const motion = new CalloutMotion()
  for (let now = 0; now <= 320; now += 16) motion.update({ ...base, now, anchors: [first] })
  const before = motion.update({ ...base, now: 336, anchors: [first] })[0]!
  const hidden = motion.update({ ...base, now: 352, anchors: [] })[0]!
  expect(before.opacity).toBe(1)
  expect(hidden.interactive).toBe(false)
  expect(hidden.opacity).toBeGreaterThan(0)
  expect(hidden.opacity).toBeLessThan(before.opacity)
  const bounce = motion.update({ ...base, now: 368, anchors: [first] })[0]!
  expect(bounce.opacity).toBeLessThan(hidden.opacity)
  expect(bounce.interactive).toBe(false)
})

it('fills auto-rotation vacancies without moving an existing card', () => {
  const motion = new CalloutMotion()
  const initial = motion.update({ ...base, now: 0, anchors: [first] })[0]!
  let cards = [initial]
  for (let now = 16; now < 1800; now += 16)
    cards = motion.update({ ...base, now, anchors: [first, second] })
  expect(cards.map((card) => card.id)).toContain('second')
  const retained = cards.find((card) => card.id === 'first')!
  expect(retained.x).toBe(initial.x)
  expect(retained.y).toBe(initial.y)
  expect(retained.opacity).toBe(1)
})

it('honors reduced motion and immediately disables occluded cards', () => {
  const motion = new CalloutMotion()
  const visible = motion.update({ ...base, now: 0, anchors: [first], reducedMotion: true })[0]!
  expect(visible.opacity).toBe(1)
  const hidden = motion.update({ ...base, now: 16, anchors: [], reducedMotion: true })[0]!
  expect(hidden.opacity).toBe(0)
  expect(hidden.interactive).toBe(false)
})

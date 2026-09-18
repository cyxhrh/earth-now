import type { GlobeInstance } from 'globe.gl'
import { categoryColors, type NewsItem } from '../news/model'
import { contains, facesCamera, type Rect, type RegionNews } from './markerLayout'

import { CalloutMotion } from './markerMotion'

const svgNamespace = 'http://www.w3.org/2000/svg'

export interface LabelReadingState {
  pages: Map<string, string>
  priority?: string
  focusLabel?: string
}

/** Project true surface coordinates into a separate, collision-aware UI layer. */
export function attachGlobeLabels(
  globe: GlobeInstance,
  host: HTMLDivElement,
  view: HTMLElement,
  regions: RegionNews[],
  selectedId: string | undefined,
  onSelect: (item: NewsItem) => void,
  onReading: (reading: boolean) => void,
  onImageError: (url: string) => void,
  readingState: LabelReadingState,
) {
  let disposed = false
  const svg = document.createElementNS(svgNamespace, 'svg')
  const countLabel = view.querySelector('.globe-card-count')
  svg.classList.add('geo-leaders')
  svg.setAttribute('aria-hidden', 'true')
  host.append(svg)
  let priority =
    regions.find((region) => region.items.some((item) => item.id === selectedId))?.id ??
    readingState.priority
  const motion = new CalloutMotion()
  const controls = globe.controls()
  let dragging = false
  let settlingUntil = 0
  let previousPoints = new Map<string, { x: number; y: number }>()
  const start = () => {
    dragging = true
    hovering = false
    setReading(false)
  }
  const end = () => {
    dragging = false
    settlingUntil = performance.now()
  }
  controls.addEventListener('start', start)
  controls.addEventListener('end', end)
  let frame = 0
  let releaseTimer = 0
  let dirty = true
  let bounds: Rect = { x: 0, y: 0, width: 0, height: 0 }
  let obstacles: Rect[] = []
  let size = { width: 184, height: 174 }
  let hovering = false
  let reading = false
  let emphasized: string | undefined

  const setReading = (value: boolean) => {
    if (reading === value) return
    reading = value
    onReading(value)
  }
  const hold = () => {
    window.clearTimeout(releaseTimer)
    setReading(true)
  }
  const release = () => {
    window.clearTimeout(releaseTimer)
    releaseTimer = window.setTimeout(() => {
      if (!hovering && !host.contains(document.activeElement)) setReading(false)
    }, 180)
  }

  const nodes = regions.map((region, regionIndex) => {
    const placeLabel = region.location.name
    const selectedIndex = region.items.findIndex((item) => item.id === selectedId)
    let index =
      selectedIndex >= 0
        ? selectedIndex
        : Math.max(
            0,
            region.items.findIndex((item) => item.id === readingState.pages.get(region.id)),
          )
    const pin = document.createElement('button')
    pin.className = 'geo-pin'
    pin.dataset.region = placeLabel
    pin.setAttribute('aria-label', `${placeLabel}，${region.items.length} 条新闻，展开地区卡片`)
    pin.setAttribute('aria-controls', `region-callout-${regionIndex}`)
    pin.title = `${placeLabel} · ${region.items.length} 条新闻（${region.anchor.kind === 'organization' ? '机构所在地，非事件地点' : '地区代表点'}）`

    const line = document.createElementNS(svgNamespace, 'g')
    line.dataset.region = placeLabel
    const underlay = document.createElementNS(svgNamespace, 'line')
    underlay.classList.add('geo-leader-outline')
    const stroke = document.createElementNS(svgNamespace, 'line')
    stroke.classList.add('geo-leader-stroke')
    line.append(underlay, stroke)
    svg.append(line)

    const card = document.createElement('div')
    card.className = 'geo-callout'
    card.id = `region-callout-${regionIndex}`
    card.dataset.region = placeLabel
    const button = document.createElement('button')
    button.className = 'map-marker'
    const footer = document.createElement('div')
    footer.className = 'region-pagination'
    const count = document.createElement('span')
    count.setAttribute('aria-live', 'polite')

    const renderArticle = () => {
      const item = region.items[index]!
      const color = categoryColors[item.category]
      card.style.setProperty('--marker-color', color)
      line.style.setProperty('--marker-color', color)
      pin.style.setProperty('--marker-color', color)
      const setImageMode = (hasImage: boolean) => {
        card.classList.toggle('is-compact', !hasImage)
        card.dataset.cardHeight = String(hasImage ? 174 : 122)
        card.style.setProperty('--callout-height', `${hasImage ? 174 : 122}px`)
        dirty = true
      }
      setImageMode(!!item.imageUrl)
      card.classList.toggle('is-organization', region.anchor.kind === 'organization')
      button.replaceChildren()
      button.dataset.newsId = item.id
      button.setAttribute(
        'aria-label',
        `查看${region.anchor.kind === 'organization' ? '机构所在地 · ' : ''}${placeLabel}新闻：${item.title}`,
      )
      button.title = item.title
      if (item.imageUrl) {
        const image = document.createElement('img')
        image.className = 'map-marker-image'
        image.alt = ''
        image.loading = 'lazy'
        image.decoding = 'async'
        image.referrerPolicy = 'no-referrer'
        image.onerror = () => {
          if (disposed) return
          image.remove()
          setImageMode(false)
          onImageError(item.imageUrl!)
        }
        image.src = item.imageUrl
        button.append(image)
      }
      const copy = document.createElement('span')
      copy.className = 'marker-copy'
      const place = document.createElement('span')
      place.className = 'marker-place'
      const placeName = document.createElement('b')
      placeName.textContent =
        region.anchor.kind === 'organization'
          ? `机构 · ${region.anchor.organization} · ${placeLabel.split('，')[0]}`
          : `${item.category} · ${placeLabel.split('，')[0]}`
      place.append(placeName)
      place.title =
        region.anchor.kind === 'organization'
          ? region.anchor.basis
          : `${placeLabel} · ${item.locationBasis ?? '地区代表位置'}`
      const title = document.createElement('strong')
      title.textContent = item.title
      copy.append(place, title)
      button.append(copy)
      button.onclick = () => onSelect(item)
      count.textContent =
        region.items.length > 1
          ? `${index + 1} / ${region.items.length} 条`
          : `${item.sourceName} · ${new Date(item.publishedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`
    }
    if (region.items.length > 1) {
      for (const direction of [-1, 1]) {
        const next = document.createElement('button')
        next.type = 'button'
        next.textContent = direction === -1 ? '‹' : '›'
        next.setAttribute(
          'aria-label',
          `${placeLabel}的${direction === -1 ? '上一条' : '下一条'}新闻`,
        )
        next.onclick = () => {
          index = (index + direction + region.items.length) % region.items.length
          readingState.pages.set(region.id, region.items[index]!.id)
          priority = region.id
          renderArticle()
        }
        footer.append(next)
        if (direction === -1) footer.append(count)
      }
    } else footer.append(count)
    card.append(button, footer)
    pin.onclick = () => {
      priority = region.id
      dirty = true
    }
    for (const element of [pin, card]) {
      element.onpointerenter = (event) => {
        if (event.pointerType === 'touch' || dragging) return
        hovering = true
        emphasized = region.id
        hold()
      }
      element.onpointerleave = () => {
        hovering = false
        emphasized = undefined
        release()
      }
      element.addEventListener('focusin', () => {
        emphasized = region.id
        hold()
      })
      element.addEventListener('focusout', () => {
        emphasized = undefined
        release()
      })
    }
    renderArticle()
    pin.hidden = true
    card.hidden = true
    line.style.display = 'none'
    host.append(pin, card)
    return { region, pin, card, line, underlay, stroke }
  })

  const measure = () => {
    const rect = view.getBoundingClientRect()
    const top = Math.max(8, rect.top + 14)
    const bottom = Math.min(window.innerHeight - 64, rect.bottom - 55)
    const left = Math.max(12, rect.left + 10)
    const right = Math.min(window.innerWidth - 12, rect.right - 10)
    bounds = {
      x: left,
      y: top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    }
    size = { width: rect.width < 500 ? 156 : 184, height: 174 }
    const controls = view.querySelector('.globe-controls')?.getBoundingClientRect()
    obstacles = controls
      ? [{ x: controls.x, y: controls.y, width: controls.width, height: controls.height }]
      : []
    host.style.setProperty('--callout-width', `${size.width}px`)
    host.style.setProperty('--callout-height', `${size.height}px`)
    dirty = true
  }
  const observer = new ResizeObserver(measure)
  observer.observe(view)
  observer.observe(document.documentElement)
  window.addEventListener('scroll', measure, { passive: true })
  window.addEventListener('resize', measure)
  measure()

  const update = (now: number) => {
    frame = requestAnimationFrame(update)
    const camera = globe.camera()
    const anchors = nodes.flatMap(({ region, card }, index) => {
      const point = globe.getScreenCoords(region.location.lat, region.location.lng)
      if (!facesCamera(globe.getCoords(region.location.lat, region.location.lng), camera.position))
        return []
      if (!contains(bounds, point, -16) || obstacles.some((rect) => contains(rect, point, 20)))
        return []
      return [
        {
          id: region.id,
          ...point,
          size: { width: size.width, height: Number(card.dataset.cardHeight ?? 122) },
          editorialPriority:
            (region.items[0]?.imageUrl ? 1000 : 0) +
            (region.anchor.kind === 'reported' ? 100 : 0) +
            (nodes.length - index) / nodes.length,
        },
      ]
    })
    const displacement = anchors.reduce((max, point) => {
      const old = previousPoints.get(point.id)
      return old ? Math.max(max, Math.hypot(point.x - old.x, point.y - old.y)) : max
    }, 0)
    previousPoints = new Map(anchors.map((point) => [point.id, point]))
    // Include camera tweens and the tail of OrbitControls damping, but not gentle auto rotation.
    if (displacement > 2) settlingUntil = now + 50
    const cards = motion.update({
      now,
      anchors,
      bounds,
      obstacles,
      size,
      priority,
      moving: dragging || now < settlingUntil,
      reflow: dirty,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    })
    dirty = false
    const visible = cards.filter((card) => card.interactive)
    const countText = `当前 ${visible.length} 张新闻卡片`
    if (countLabel && countLabel.textContent !== countText) countLabel.textContent = countText
    for (const node of nodes) {
      const anchor = anchors.find((point) => point.id === node.region.id)
      const card = cards.find((item) => item.id === node.region.id)
      const pinVisible =
        !!anchor && !cards.some((rect) => rect.opacity > 0.1 && contains(rect, anchor, 18))
      node.pin.hidden = !pinVisible
      node.card.hidden = !card || card.opacity === 0
      node.card.inert = !card?.interactive || dragging
      node.card.style.opacity = String(card?.opacity ?? 0)
      node.card.style.pointerEvents = card?.interactive && !dragging ? '' : 'none'
      node.line.style.display = card && card.opacity > 0 ? '' : 'none'
      node.line.style.opacity = String(card?.opacity ?? 0)
      node.pin.setAttribute('aria-expanded', String(!!card?.interactive))
      node.pin.classList.toggle('is-linked', !!card?.interactive)
      const active = (emphasized ?? priority) === node.region.id
      node.card.classList.toggle('is-active', active)
      node.line.classList.toggle('is-active', active)
      node.pin.classList.toggle('is-active', active)
      if (pinVisible) node.pin.style.transform = `translate(${anchor.x}px, ${anchor.y}px)`
      if (card) {
        node.card.style.transform = `translate(${card.x}px, ${card.y}px)`
        for (const line of [node.stroke, node.underlay]) {
          line.setAttribute('x1', String(card.anchor.x))
          line.setAttribute('y1', String(card.anchor.y))
          line.setAttribute('x2', String(card.end.x))
          line.setAttribute('y2', String(card.end.y))
        }
      }
    }
    if (readingState.focusLabel) {
      const target = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) =>
          button.getAttribute('aria-label') === readingState.focusLabel &&
          !button.closest('[hidden], [inert]'),
      )
      if (target) {
        readingState.focusLabel = undefined
        target.focus({ preventScroll: true })
      }
    }
  }
  frame = requestAnimationFrame(update)
  return () => {
    disposed = true
    readingState.priority = priority
    readingState.focusLabel = host.contains(document.activeElement)
      ? (document.activeElement?.getAttribute('aria-label') ?? undefined)
      : undefined
    controls.removeEventListener('start', start)
    controls.removeEventListener('end', end)
    cancelAnimationFrame(frame)
    window.clearTimeout(releaseTimer)
    observer.disconnect()
    window.removeEventListener('scroll', measure)
    window.removeEventListener('resize', measure)
    host.replaceChildren()
    if (reading) onReading(false)
  }
}

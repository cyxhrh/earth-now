import { useEffect, useMemo, useRef, useState } from 'react'
import type { GlobeInstance } from 'globe.gl'
import type { MeshPhongMaterial, PerspectiveCamera } from 'three'
import { Crosshair, Minus, Pause, Play, Plus } from 'lucide-react'
import type { NewsItem } from '../news/model'
import { getMapAnchor } from '../news/mapAnchor'
import { groupRegions } from './markerLayout'
import { attachGlobeLabels, type LabelReadingState } from './globeLabels'

interface Props {
  items: NewsItem[]
  selected: NewsItem | null
  onSelect: (item: NewsItem) => void
  isLive: boolean
  onImageError: (url: string) => void
}
const home = { lat: 22, lng: 105, altitude: 1.35 }
const earthTextureUrl = '/textures/earth-blue-ocean-8k.jpg'

export default function GlobeView({ items, selected, onSelect, isLive, onImageError }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<HTMLElement>(null)
  const labels = useRef<HTMLDivElement>(null)
  const labelReadingState = useRef<LabelReadingState>({ pages: new Map() })
  const focusedChannel = items.some((item) => item.channel === 'AI' || item.channel === '科技')
  const regions = useMemo(
    () => groupRegions(items, focusedChannel, focusedChannel ? 3 : 2),
    [items, focusedChannel],
  )
  const exploreIndex = useRef(0)
  const explorePlaces = useMemo(
    () => [
      ...new Map(
        regions.map((region) => [`${region.location.lat},${region.location.lng}`, region.location]),
      ).values(),
    ],
    [regions],
  )
  const [readingMarker, setReadingMarker] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const globe = useRef<GlobeInstance | null>(null)
  const selectRef = useRef(onSelect)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [rotating, setRotating] = useState(
    () => !matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const [reducedMotion, setReducedMotion] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const autoRotating = rotating && !reducedMotion && !selected && !readingMarker
  useEffect(() => {
    selectRef.current = onSelect
  }, [onSelect])
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => {
      setReducedMotion(media.matches)
      if (media.matches) setRotating(false)
    }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    let disposed = false
    let resize: ResizeObserver | undefined
    let instance: GlobeInstance | undefined
    let layoutFrame = 0
    const container = host.current!
    // The stage only controls framing. Rendering uses the entire viewport, so
    // zooming can extend beyond the stage without hitting a canvas edge.
    const updateLayout = () => {
      if (!instance || !stage.current) return
      const viewport = container.getBoundingClientRect()
      const frame = stage.current.getBoundingClientRect()
      if (!viewport.width || !viewport.height || !frame.height) return
      instance.width(viewport.width).height(viewport.height)
      instance.globeOffset([
        frame.left + frame.width / 2 - viewport.left - viewport.width / 2,
        frame.top + frame.height / 2 - viewport.top - viewport.height / 2,
      ])
      const camera = instance.camera() as PerspectiveCamera
      camera.zoom = frame.height / viewport.height
      camera.updateProjectionMatrix()
    }
    const scheduleLayout = () => {
      cancelAnimationFrame(layoutFrame)
      layoutFrame = requestAnimationFrame(updateLayout)
    }
    const handleContextLoss = (event: Event) => {
      event.preventDefault()
      setError('地球图形连接已中断，请刷新页面。新闻列表仍可使用。')
    }
    async function mount() {
      try {
        const [{ default: Globe }] = await Promise.all([
          import('globe.gl'),
          new Promise<void>((resolve, reject) => {
            const texture = new Image()
            texture.onload = () => resolve()
            texture.onerror = () => reject(new Error('地球纹理加载失败，请刷新重试。'))
            texture.src = earthTextureUrl
          }),
        ])
        if (disposed) return
        instance = new Globe(container, {
          animateIn: false,
          rendererConfig: { antialias: true, alpha: true },
        })
          .backgroundColor('#00000000')
          .globeImageUrl(earthTextureUrl)
          .globeCurvatureResolution(1.5)
          .showAtmosphere(true)
          .atmosphereColor('#80bfd8')
          .atmosphereAltitude(0.13)
          .pointOfView(home)
          .pointLat('lat')
          .pointLng('lng')
          .pointAltitude(0.008)
          .pointRadius(0.32)
          .pointColor('color')
          .pointsTransitionDuration(0)
          .onGlobeReady(() => {
            if (disposed || !instance) return
            const texture = (instance.globeMaterial() as MeshPhongMaterial).map
            if (texture) {
              texture.anisotropy = Math.min(8, instance.renderer().capabilities.getMaxAnisotropy())
              texture.needsUpdate = true
            }
            setReady(true)
          })
        // Modest supersampling sharpens coastlines on 1x displays; cap the
        // full-viewport framebuffer at 2x to keep GPU memory bounded.
        instance.renderer().setPixelRatio(Math.min(Math.max(devicePixelRatio, 1.5), 2))
        instance.renderer().domElement.addEventListener('webglcontextlost', handleContextLoss)
        instance.controls().enablePan = false
        instance.controls().minDistance = 150
        instance.controls().maxDistance = 550
        instance.controls().autoRotateSpeed = 0.3
        globe.current = instance
        updateLayout()
        resize = new ResizeObserver(scheduleLayout)
        resize.observe(container)
        resize.observe(stage.current!)
        resize.observe(document.documentElement)
        window.addEventListener('scroll', scheduleLayout, { passive: true })
        window.addEventListener('resize', scheduleLayout)
      } catch (cause) {
        if (!disposed)
          setError(
            cause instanceof Error && cause.message.includes('纹理')
              ? cause.message
              : '此设备暂时无法显示 3D 地球，你仍可通过列表探索新闻。',
          )
      }
    }
    void mount()
    return () => {
      disposed = true
      resize?.disconnect()
      cancelAnimationFrame(layoutFrame)
      window.removeEventListener('scroll', scheduleLayout)
      window.removeEventListener('resize', scheduleLayout)
      instance?.renderer().domElement.removeEventListener('webglcontextlost', handleContextLoss)
      instance?._destructor()
      globe.current = null
      container.replaceChildren()
    }
  }, [])

  useEffect(() => {
    if (!ready || !globe.current || !labels.current || !view.current) return
    // The interactive rings and leader lines share the same surface projection.
    // Do not render duplicate HTML labels or one WebGL point per article.
    globe.current.pointsData([])
    return attachGlobeLabels(
      globe.current,
      labels.current,
      view.current,
      regions,
      selected?.id,
      (item) => selectRef.current(item),
      setReadingMarker,
      onImageError,
      labelReadingState.current,
    )
  }, [regions, selected?.id, ready, onImageError])

  useEffect(() => {
    const anchor = selected ? getMapAnchor(selected) : null
    if (ready && anchor) {
      globe.current?.pointOfView(
        { lat: anchor.location.lat, lng: anchor.location.lng, altitude: home.altitude },
        reducedMotion ? 0 : 1000,
      )
    }
  }, [selected, ready, reducedMotion])
  useEffect(() => {
    if (ready && globe.current) globe.current.controls().autoRotate = autoRotating
  }, [autoRotating, ready])

  function zoom(multiplier: number) {
    const current = globe.current?.pointOfView()
    if (current)
      globe.current?.pointOfView(
        { altitude: Math.max(0.55, Math.min(3.8, (current.altitude ?? 2) * multiplier)) },
        reducedMotion ? 0 : 350,
      )
  }

  return (
    <section className="globe-view" ref={view} aria-label="交互式新闻地球">
      <h1 className="sr-only">全球新闻地球</h1>
      <div className="globe-stage" ref={stage} aria-hidden="true" />
      <div className="globe-mount" ref={host} />
      <div className="globe-labels" ref={labels} />
      {!ready && !error && (
        <div className="globe-message" role="status">
          <span className="loading-orbit" />
          正在展开地球…
        </div>
      )}
      {error && (
        <div className="globe-message" role="alert">
          {error}
        </div>
      )}
      <div className="globe-controls" aria-label="地球控制">
        <button
          className="icon-button"
          disabled={!ready || !!error}
          onClick={() => zoom(0.8)}
          aria-label="放大地球"
          title="放大"
        >
          <Plus size={18} />
        </button>
        <button
          className="icon-button"
          disabled={!ready || !!error}
          onClick={() => zoom(1.25)}
          aria-label="缩小地球"
          title="缩小"
        >
          <Minus size={18} />
        </button>
        <span className="control-divider" />
        <button
          className="icon-button"
          disabled={!ready || !!error}
          onClick={() => globe.current?.pointOfView(home, reducedMotion ? 0 : 900)}
          aria-label="复位地球视角"
          title="复位视角"
        >
          <Crosshair size={17} />
        </button>
        <button
          className="icon-button"
          disabled={!ready || !!error || reducedMotion || !!selected || readingMarker}
          onClick={() => setRotating((value) => !value)}
          aria-label={
            selected
              ? '阅读时暂停旋转'
              : readingMarker
                ? '浏览地区时暂停旋转'
                : autoRotating
                  ? '暂停旋转'
                  : '自动旋转'
          }
          aria-pressed={autoRotating}
          title={
            selected
              ? '阅读时暂停旋转'
              : readingMarker
                ? '移开鼠标和焦点后恢复自转'
                : reducedMotion
                  ? '减少动态效果已开启'
                  : '自动旋转'
          }
        >
          {autoRotating ? <Pause size={16} /> : <Play size={16} />}
        </button>
      </div>
      <div className="globe-footnote">
        <span className="small-dot" />
        <span className="globe-card-count">
          {regions.length} 个{isLive ? '新闻地区' : '演示地区'}
        </span>
        <span>
          {focusedChannel ? '连线跟随地点 · “机构”标注公司所在地' : '点击圆点展开 · 地区代表位置'}
        </span>
        <button
          className="explore-location"
          disabled={!ready || !explorePlaces.length}
          onClick={() => {
            const place = explorePlaces[exploreIndex.current++ % explorePlaces.length]
            globe.current?.pointOfView(
              { lat: place.lat, lng: place.lng, altitude: home.altitude },
              reducedMotion ? 0 : 1000,
            )
          }}
        >
          下一处新闻 ↗
        </button>
      </div>
      <span className="texture-credit">地球影像 · NASA BLUE MARBLE</span>
    </section>
  )
}

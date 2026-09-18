import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import type { NewsItem } from './model'

export function NewsImage({
  item,
  className = '',
  onImageError,
  hideWhenMissing = false,
}: {
  item: NewsItem
  className?: string
  onImageError?: (url: string) => void
  hideWhenMissing?: boolean
}) {
  const [failedUrl, setFailedUrl] = useState<string>()
  const hasImage = item.imageUrl && item.imageUrl !== failedUrl
  if (!hasImage && hideWhenMissing) return null
  return (
    <div className={`news-image ${className}`}>
      {hasImage ? (
        <img
          src={item.imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => {
            setFailedUrl(item.imageUrl)
            if (item.imageUrl) onImageError?.(item.imageUrl)
          }}
        />
      ) : (
        <span className="image-placeholder">
          <ImageOff size={22} strokeWidth={1.2} />
          <span>暂无配图</span>
        </span>
      )}
    </div>
  )
}

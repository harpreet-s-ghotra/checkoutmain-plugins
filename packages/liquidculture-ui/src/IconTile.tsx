import { cn } from './cn'
import './icon-tile.css'

export type IconTileTone = 'primary' | 'subtle'
export type IconTileSize = 'sm' | 'md'

/** Rounded icon container — the navy (or subtle) box used in headers & tiles. */
export function IconTile({
  tone = 'primary',
  size = 'md',
  className,
  children
}: {
  tone?: IconTileTone
  size?: IconTileSize
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span className={cn('ui-icontile', `ui-icontile--${tone}`, `ui-icontile--${size}`, className)}>
      {children}
    </span>
  )
}

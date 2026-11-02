import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { IconTile, type IconTileTone, type IconTileSize } from './IconTile'

describe('IconTile', () => {
  it('renders as span element', () => {
    const { container } = render(<IconTile>Icon</IconTile>)
    const span = container.querySelector('span')
    expect(span?.tagName).toBe('SPAN')
  })

  it('applies ui-icontile class', () => {
    const { container } = render(<IconTile>Icon</IconTile>)
    const span = container.querySelector('span')
    expect(span).toHaveClass('ui-icontile')
  })

  it('renders with default primary tone', () => {
    const { container } = render(<IconTile>Icon</IconTile>)
    const span = container.querySelector('span')
    expect(span).toHaveClass('ui-icontile--primary')
  })

  it('renders with all tone variants', () => {
    const tones: IconTileTone[] = ['primary', 'subtle']
    tones.forEach((tone) => {
      const { unmount, container } = render(<IconTile tone={tone}>Icon {tone}</IconTile>)
      const span = container.querySelector('span')
      expect(span).toHaveClass(`ui-icontile--${tone}`)
      unmount()
    })
  })

  it('renders with default md size', () => {
    const { container } = render(<IconTile>Icon</IconTile>)
    const span = container.querySelector('span')
    expect(span).toHaveClass('ui-icontile--md')
  })

  it('renders with all size variants', () => {
    const sizes: IconTileSize[] = ['sm', 'md']
    sizes.forEach((size) => {
      const { unmount, container } = render(<IconTile size={size}>Icon {size}</IconTile>)
      const span = container.querySelector('span')
      expect(span).toHaveClass(`ui-icontile--${size}`)
      unmount()
    })
  })

  it('renders with lucide icon', () => {
    render(
      <IconTile>
        <AlertCircle data-testid="alert-icon" />
      </IconTile>
    )
    expect(screen.getByTestId('alert-icon')).toBeInTheDocument()
  })

  it('renders with text content', () => {
    render(
      <IconTile>
        <span>Text</span>
      </IconTile>
    )
    expect(screen.getByText('Text')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(<IconTile className="custom-class">Icon</IconTile>)
    const span = container.querySelector('span')
    expect(span).toHaveClass('custom-class')
    expect(span).toHaveClass('ui-icontile')
  })

  it('combines all classes correctly', () => {
    const { container } = render(
      <IconTile tone="subtle" size="sm" className="extra">
        Icon
      </IconTile>
    )
    const span = container.querySelector('span')
    expect(span).toHaveClass('ui-icontile', 'ui-icontile--subtle', 'ui-icontile--sm', 'extra')
  })

  it('renders complex icon content', () => {
    render(
      <IconTile tone="primary" size="md">
        <div data-testid="complex">
          <CheckCircle2 size={24} />
          <span>Done</span>
        </div>
      </IconTile>
    )
    expect(screen.getByTestId('complex')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('renders multiple children', () => {
    render(
      <IconTile>
        <span>First</span>
        <span>Second</span>
      </IconTile>
    )
    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
  })

  it('renders with all combinations', () => {
    const tones: IconTileTone[] = ['primary', 'subtle']
    const sizes: IconTileSize[] = ['sm', 'md']

    tones.forEach((tone) => {
      sizes.forEach((size) => {
        const { unmount, container } = render(
          <IconTile tone={tone} size={size}>
            {tone}-{size}
          </IconTile>
        )
        const span = container.querySelector('span')
        expect(span).toHaveClass(`ui-icontile--${tone}`, `ui-icontile--${size}`)
        unmount()
      })
    })
  })
})

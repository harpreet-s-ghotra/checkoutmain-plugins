import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Badge, Tag, type BadgeTone } from './Badge'

describe('Badge', () => {
  it('renders with default neutral tone', () => {
    render(<Badge>Default Badge</Badge>)
    const badge = screen.getByText('Default Badge')
    expect(badge).toHaveClass('ui-badge')
    expect(badge).toHaveClass('ui-badge--neutral')
  })

  it('renders with specified tone', () => {
    const tones: BadgeTone[] = ['success', 'warning', 'danger', 'info']
    tones.forEach((tone) => {
      const { unmount } = render(<Badge tone={tone}>Badge {tone}</Badge>)
      const badge = screen.getByText(`Badge ${tone}`)
      expect(badge).toHaveClass(`ui-badge--${tone}`)
      unmount()
    })
  })

  it('applies uppercase class when uppercase prop is true', () => {
    render(<Badge uppercase>Uppercase Badge</Badge>)
    const badge = screen.getByText('Uppercase Badge')
    expect(badge).toHaveClass('ui-badge--upper')
  })

  it('does not apply uppercase class by default', () => {
    render(<Badge>Normal Badge</Badge>)
    const badge = screen.getByText('Normal Badge')
    expect(badge).not.toHaveClass('ui-badge--upper')
  })

  it('applies custom className', () => {
    render(<Badge className="custom-class">Custom Badge</Badge>)
    const badge = screen.getByText('Custom Badge')
    expect(badge).toHaveClass('custom-class')
    expect(badge).toHaveClass('ui-badge')
  })

  it('renders children correctly', () => {
    render(
      <Badge>
        <span>Nested Content</span>
      </Badge>
    )
    expect(screen.getByText('Nested Content')).toBeInTheDocument()
  })

  it('combines all classes correctly', () => {
    render(
      <Badge tone="success" uppercase className="extra">
        Complete
      </Badge>
    )
    const badge = screen.getByText('Complete')
    expect(badge).toHaveClass('ui-badge', 'ui-badge--success', 'ui-badge--upper', 'extra')
  })
})

describe('Tag', () => {
  it('renders with correct tint class', () => {
    render(<Tag tint={1}>Category 1</Tag>)
    const tag = screen.getByText('Category 1')
    expect(tag).toHaveClass('ui-tag')
    expect(tag).toHaveClass('ui-tag--1')
  })

  it('cycles tint values using modulo', () => {
    const testCases = [
      { tint: 1, expected: '1' },
      { tint: 2, expected: '2' },
      { tint: 6, expected: '6' },
      { tint: 7, expected: '1' },
      { tint: 13, expected: '1' },
      { tint: 14, expected: '2' }
    ]

    testCases.forEach(({ tint, expected }) => {
      const { unmount } = render(<Tag tint={tint}>Tag {tint}</Tag>)
      const tag = screen.getByText(`Tag ${tint}`)
      expect(tag).toHaveClass(`ui-tag--${expected}`)
      unmount()
    })
  })

  it('applies custom className', () => {
    render(
      <Tag tint={3} className="custom">
        Custom Tag
      </Tag>
    )
    const tag = screen.getByText('Custom Tag')
    expect(tag).toHaveClass('ui-tag', 'ui-tag--3', 'custom')
  })

  it('renders children correctly', () => {
    render(
      <Tag tint={2}>
        <strong>Bold Category</strong>
      </Tag>
    )
    expect(screen.getByText('Bold Category')).toBeInTheDocument()
  })

  it('handles negative tint values', () => {
    render(<Tag tint={-5}>Negative Tint</Tag>)
    const tag = screen.getByText('Negative Tint')
    // -5 % 6 = -5, then -5 + 1 = -4, then ((-4) % 6) + 1
    // Actually: ((-5 - 1) % 6) + 1 = ((-6) % 6) + 1 = 0 + 1 = 1
    expect(tag).toHaveClass('ui-tag--1')
  })
})

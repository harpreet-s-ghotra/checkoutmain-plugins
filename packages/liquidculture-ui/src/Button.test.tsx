import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { Button, type ButtonVariant, type ButtonSize } from './Button'

describe('Button', () => {
  it('renders as a button element', () => {
    render(<Button>Click me</Button>)
    const button = screen.getByRole('button', { name: 'Click me' })
    expect(button).toBeInTheDocument()
    expect(button.tagName).toBe('BUTTON')
  })

  it('has default type="button"', () => {
    render(<Button>Default Type</Button>)
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('type', 'button')
  })

  it('allows custom type attribute', () => {
    render(<Button type="submit">Submit</Button>)
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('type', 'submit')
  })

  it('renders with default primary variant', () => {
    render(<Button>Primary</Button>)
    const button = screen.getByRole('button')
    expect(button).toHaveClass('ui-btn')
    expect(button).toHaveClass('ui-btn--primary')
  })

  it('renders with all variants', () => {
    const variants: ButtonVariant[] = [
      'primary',
      'success',
      'secondary',
      'danger',
      'ghost',
      'neutral'
    ]
    variants.forEach((variant) => {
      const { unmount } = render(<Button variant={variant}>Button {variant}</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass(`ui-btn--${variant}`)
      unmount()
    })
  })

  it('renders with all sizes', () => {
    const sizes: ButtonSize[] = ['sm', 'md', 'lg']
    sizes.forEach((size) => {
      const { unmount } = render(<Button size={size}>Button {size}</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass(`ui-btn--${size}`)
      unmount()
    })
  })

  it('renders with default md size', () => {
    render(<Button>Medium</Button>)
    const button = screen.getByRole('button')
    expect(button).toHaveClass('ui-btn--md')
  })

  it('applies block class when block prop is true', () => {
    render(<Button block>Block Button</Button>)
    const button = screen.getByRole('button')
    expect(button).toHaveClass('ui-btn--block')
  })

  it('does not apply block class by default', () => {
    render(<Button>Inline Button</Button>)
    const button = screen.getByRole('button')
    expect(button).not.toHaveClass('ui-btn--block')
  })

  it('applies custom className', () => {
    render(<Button className="custom-class">Custom</Button>)
    const button = screen.getByRole('button')
    expect(button).toHaveClass('custom-class')
    expect(button).toHaveClass('ui-btn')
  })

  it('combines all classes correctly', () => {
    render(
      <Button variant="danger" size="lg" block className="extra">
        Delete
      </Button>
    )
    const button = screen.getByRole('button')
    expect(button).toHaveClass('ui-btn', 'ui-btn--danger', 'ui-btn--lg', 'ui-btn--block', 'extra')
  })

  it('handles click events', async () => {
    const handleClick = vi.fn()
    render(<Button onClick={handleClick}>Click</Button>)
    const button = screen.getByRole('button')
    await userEvent.click(button)
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('disables button when disabled prop is set', () => {
    render(<Button disabled>Disabled</Button>)
    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
  })

  it('respects disabled state and does not trigger onClick', async () => {
    const handleClick = vi.fn()
    render(
      <Button onClick={handleClick} disabled>
        Disabled Click
      </Button>
    )
    const button = screen.getByRole('button')
    await userEvent.click(button)
    expect(handleClick).not.toHaveBeenCalled()
  })

  it('forwards ref correctly', () => {
    const ref = { current: null as HTMLButtonElement | null }
    render(<Button ref={ref}>Ref Button</Button>)
    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
    expect(ref.current?.textContent).toBe('Ref Button')
  })

  it('renders children correctly', () => {
    render(
      <Button>
        <span>Icon</span> Label
      </Button>
    )
    expect(screen.getByText('Icon')).toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveTextContent('Icon Label')
  })

  it('passes through other HTMLButtonElement attributes', () => {
    render(
      <Button aria-label="Custom aria" data-testid="custom-btn" title="Hover text">
        Button
      </Button>
    )
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-label', 'Custom aria')
    expect(button).toHaveAttribute('data-testid', 'custom-btn')
    expect(button).toHaveAttribute('title', 'Hover text')
  })
})

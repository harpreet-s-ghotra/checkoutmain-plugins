import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { Checkbox } from './Checkbox'

describe('Checkbox', () => {
  it('renders with label', () => {
    render(<Checkbox checked={false} onChange={vi.fn()} label="Accept terms" />)
    expect(screen.getByText('Accept terms')).toBeInTheDocument()
  })

  it('renders checkbox input', () => {
    render(<Checkbox checked={false} onChange={vi.fn()} label="Test" />)
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toBeInTheDocument()
  })

  it('reflects checked state', () => {
    const { rerender } = render(<Checkbox checked={false} onChange={vi.fn()} label="Test" />)
    let checkbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(checkbox.checked).toBe(false)

    rerender(<Checkbox checked={true} onChange={vi.fn()} label="Test" />)
    checkbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
  })

  it('calls onChange with true when unchecked and clicked', async () => {
    const onChange = vi.fn()
    render(<Checkbox checked={false} onChange={onChange} label="Test" />)
    const checkbox = screen.getByRole('checkbox')
    await userEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('calls onChange with false when checked and clicked', async () => {
    const onChange = vi.fn()
    render(<Checkbox checked={true} onChange={onChange} label="Test" />)
    const checkbox = screen.getByRole('checkbox')
    await userEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('renders description when provided', () => {
    render(
      <Checkbox checked={false} onChange={vi.fn()} label="Label" description="Description text" />
    )
    expect(screen.getByText('Description text')).toBeInTheDocument()
  })

  it('does not render description when not provided', () => {
    render(<Checkbox checked={false} onChange={vi.fn()} label="Label" />)
    expect(screen.queryByText('Description text')).not.toBeInTheDocument()
  })

  it('applies boxed class by default', () => {
    const { container } = render(<Checkbox checked={false} onChange={vi.fn()} label="Test" />)
    const label = container.querySelector('label')
    expect(label).toHaveClass('ui-checkbox')
    expect(label).toHaveClass('ui-checkbox--boxed')
  })

  it('does not apply boxed class when boxed is false', () => {
    const { container } = render(
      <Checkbox checked={false} onChange={vi.fn()} label="Test" boxed={false} />
    )
    const label = container.querySelector('label')
    expect(label).toHaveClass('ui-checkbox')
    expect(label).not.toHaveClass('ui-checkbox--boxed')
  })

  it('applies custom className', () => {
    const { container } = render(
      <Checkbox checked={false} onChange={vi.fn()} label="Test" className="custom-class" />
    )
    const label = container.querySelector('label')
    expect(label).toHaveClass('custom-class')
    expect(label).toHaveClass('ui-checkbox')
  })

  it('is keyboard accessible', async () => {
    const onChange = vi.fn()
    render(<Checkbox checked={false} onChange={onChange} label="Keyboard test" />)
    const checkbox = screen.getByRole('checkbox')

    // Focus the checkbox
    checkbox.focus()
    expect(checkbox).toHaveFocus()

    // Simulate space key toggle
    await userEvent.keyboard(' ')
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('handles rapid onChange calls', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<Checkbox checked={false} onChange={onChange} label="Test" />)

    const checkbox = screen.getByRole('checkbox')
    await userEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledWith(true)

    rerender(<Checkbox checked={true} onChange={onChange} label="Test" />)
    await userEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledWith(false)

    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('renders with all elements in correct order', () => {
    const { container } = render(
      <Checkbox checked={false} onChange={vi.fn()} label="Label" description="Description" />
    )

    const label = container.querySelector('label')
    const input = container.querySelector('input[type="checkbox"]')
    const textSpan = container.querySelector('.ui-checkbox__text')
    const labelSpan = container.querySelector('.ui-checkbox__label')
    const descSpan = container.querySelector('.ui-checkbox__desc')

    expect(label).toBeInTheDocument()
    expect(input).toBeInTheDocument()
    expect(textSpan).toBeInTheDocument()
    expect(labelSpan).toBeInTheDocument()
    expect(descSpan).toBeInTheDocument()

    // Verify hierarchy
    expect(label?.contains(input)).toBe(true)
    expect(label?.contains(textSpan)).toBe(true)
    expect(textSpan?.contains(labelSpan)).toBe(true)
    expect(textSpan?.contains(descSpan)).toBe(true)
  })

  it('can be toggled multiple times', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<Checkbox checked={false} onChange={onChange} label="Test" />)

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement

    for (let i = 0; i < 5; i++) {
      await userEvent.click(checkbox)
      expect(onChange).toHaveBeenCalledWith(i % 2 === 0)
      rerender(<Checkbox checked={i % 2 === 0} onChange={onChange} label="Test" />)
    }

    expect(onChange).toHaveBeenCalledTimes(5)
  })
})

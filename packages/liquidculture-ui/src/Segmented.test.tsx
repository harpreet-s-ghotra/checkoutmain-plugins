import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { Segmented, type SegmentedOption } from './Segmented'

describe('Segmented', () => {
  const defaultOptions: SegmentedOption<'each' | 'weight'>[] = [
    { value: 'each', label: 'Each' },
    { value: 'weight', label: 'By Weight' }
  ]

  it('renders as a group', () => {
    const { container } = render(
      <Segmented options={defaultOptions} value="each" onChange={vi.fn()} />
    )
    const group = container.querySelector('[role="group"]')
    expect(group).toHaveClass('ui-segmented')
  })

  it('renders all options as buttons', () => {
    render(<Segmented options={defaultOptions} value="each" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Each' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'By Weight' })).toBeInTheDocument()
  })

  it('marks active option with --on class and aria-pressed', () => {
    render(<Segmented options={defaultOptions} value="each" onChange={vi.fn()} />)
    const eachBtn = screen.getByRole('button', { name: 'Each' })
    const weightBtn = screen.getByRole('button', { name: 'By Weight' })

    expect(eachBtn).toHaveClass('ui-segmented__opt--on')
    expect(eachBtn).toHaveAttribute('aria-pressed', 'true')

    expect(weightBtn).not.toHaveClass('ui-segmented__opt--on')
    expect(weightBtn).toHaveAttribute('aria-pressed', 'false')
  })

  it('updates aria-pressed when value changes', () => {
    const { rerender } = render(
      <Segmented options={defaultOptions} value="each" onChange={vi.fn()} />
    )
    let eachBtn = screen.getByRole('button', { name: 'Each' })
    expect(eachBtn).toHaveAttribute('aria-pressed', 'true')

    rerender(<Segmented options={defaultOptions} value="weight" onChange={vi.fn()} />)
    eachBtn = screen.getByRole('button', { name: 'Each' })
    const weightBtn = screen.getByRole('button', { name: 'By Weight' })
    expect(eachBtn).toHaveAttribute('aria-pressed', 'false')
    expect(weightBtn).toHaveAttribute('aria-pressed', 'true')
  })

  it('calls onChange with correct value when option is clicked', async () => {
    const onChange = vi.fn()
    render(<Segmented options={defaultOptions} value="each" onChange={onChange} />)
    const weightBtn = screen.getByRole('button', { name: 'By Weight' })
    await userEvent.click(weightBtn)
    expect(onChange).toHaveBeenCalledWith('weight')
  })

  it('does not call onChange when already active option is clicked', async () => {
    const onChange = vi.fn()
    render(<Segmented options={defaultOptions} value="each" onChange={onChange} />)
    const eachBtn = screen.getByRole('button', { name: 'Each' })
    await userEvent.click(eachBtn)
    expect(onChange).toHaveBeenCalledWith('each')
  })

  it('applies custom aria-label to group', () => {
    const { container } = render(
      <Segmented options={defaultOptions} value="each" onChange={vi.fn()} ariaLabel="Unit type" />
    )
    const group = container.querySelector('[role="group"]')
    expect(group).toHaveAttribute('aria-label', 'Unit type')
  })

  it('applies aria-label to each option', () => {
    render(<Segmented options={defaultOptions} value="each" onChange={vi.fn()} />)
    const eachBtn = screen.getByRole('button', { name: 'Each' })
    const weightBtn = screen.getByRole('button', { name: 'By Weight' })
    expect(eachBtn).toHaveAttribute('aria-label', 'Each')
    expect(weightBtn).toHaveAttribute('aria-label', 'By Weight')
  })

  it('handles single option', () => {
    const singleOption: SegmentedOption<'only'>[] = [{ value: 'only', label: 'Only Option' }]
    render(<Segmented options={singleOption} value="only" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Only Option' })).toBeInTheDocument()
  })

  it('handles many options', () => {
    const manyOptions: SegmentedOption<'a' | 'b' | 'c' | 'd' | 'e'>[] = [
      { value: 'a', label: 'Option A' },
      { value: 'b', label: 'Option B' },
      { value: 'c', label: 'Option C' },
      { value: 'd', label: 'Option D' },
      { value: 'e', label: 'Option E' }
    ]
    render(<Segmented options={manyOptions} value="c" onChange={vi.fn()} />)
    for (const opt of manyOptions) {
      expect(screen.getByRole('button', { name: opt.label })).toBeInTheDocument()
    }
  })

  it('is keyboard accessible with arrow keys', async () => {
    const onChange = vi.fn()
    render(<Segmented options={defaultOptions} value="each" onChange={onChange} />)
    const eachBtn = screen.getByRole('button', { name: 'Each' })
    eachBtn.focus()
    expect(eachBtn).toHaveFocus()
  })

  it('handles rapid option changes', async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <Segmented options={defaultOptions} value="each" onChange={onChange} />
    )
    const weightBtn = screen.getByRole('button', { name: 'By Weight' })
    await userEvent.click(weightBtn)
    expect(onChange).toHaveBeenCalledWith('weight')

    rerender(<Segmented options={defaultOptions} value="weight" onChange={onChange} />)
    const eachBtn = screen.getByRole('button', { name: 'Each' })
    await userEvent.click(eachBtn)
    expect(onChange).toHaveBeenCalledWith('each')
  })

  it('displays correct labels', () => {
    const customOptions: SegmentedOption<'metric' | 'imperial'>[] = [
      { value: 'metric', label: 'Metric' },
      { value: 'imperial', label: 'Imperial' }
    ]
    render(<Segmented options={customOptions} value="metric" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Metric' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Imperial' })).toBeInTheDocument()
  })

  it('all options have type="button"', () => {
    render(<Segmented options={defaultOptions} value="each" onChange={vi.fn()} />)
    const buttons = screen.getAllByRole('button')
    buttons.forEach((btn) => {
      expect(btn).toHaveAttribute('type', 'button')
    })
  })

  it('renders options in order', () => {
    render(<Segmented options={defaultOptions} value="each" onChange={vi.fn()} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons[0]).toHaveTextContent('Each')
    expect(buttons[1]).toHaveTextContent('By Weight')
  })
})

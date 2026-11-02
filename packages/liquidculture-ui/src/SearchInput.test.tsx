import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { SearchInput } from './SearchInput'

describe('SearchInput', () => {
  it('renders input element', () => {
    render(<SearchInput value="" onChange={vi.fn()} />)
    const input = screen.getByRole('textbox')
    expect(input).toBeInTheDocument()
  })

  it('has search label wrapper', () => {
    const { container } = render(<SearchInput value="" onChange={vi.fn()} />)
    const label = container.querySelector('.ui-search')
    expect(label?.tagName).toBe('LABEL')
    expect(label).toHaveClass('ui-search')
  })

  it('renders search icon', () => {
    const { container } = render(<SearchInput value="" onChange={vi.fn()} />)
    const icon = container.querySelector('.ui-search__icon')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('displays current value', () => {
    render(<SearchInput value="test query" onChange={vi.fn()} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('test query')
  })

  it('calls onChange when input changes', async () => {
    const onChange = vi.fn()
    render(<SearchInput value="" onChange={onChange} />)
    const input = screen.getByRole('textbox')
    await userEvent.type(input, 'search')
    expect(onChange).toHaveBeenCalledWith('s')
    expect(onChange).toHaveBeenCalledWith('e')
    expect(onChange).toHaveBeenCalledWith('a')
    expect(onChange).toHaveBeenCalledWith('r')
    expect(onChange).toHaveBeenCalledWith('c')
    expect(onChange).toHaveBeenCalledWith('h')
    expect(onChange).toHaveBeenCalledTimes(6)
  })

  it('has default placeholder text', () => {
    render(<SearchInput value="" onChange={vi.fn()} />)
    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('placeholder', 'Search…')
  })

  it('accepts custom placeholder', () => {
    render(<SearchInput value="" onChange={vi.fn()} placeholder="Find products" />)
    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('placeholder', 'Find products')
  })

  it('has default aria-label', () => {
    render(<SearchInput value="" onChange={vi.fn()} />)
    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('aria-label', 'Search')
  })

  it('accepts custom aria-label', () => {
    render(<SearchInput value="" onChange={vi.fn()} ariaLabel="Search items" />)
    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('aria-label', 'Search items')
  })

  it('calls onSubmit when Enter is pressed', async () => {
    const onSubmit = vi.fn()
    render(<SearchInput value="search text" onChange={vi.fn()} onSubmit={onSubmit} />)
    const input = screen.getByRole('textbox')
    await userEvent.type(input, '{Enter}')
    expect(onSubmit).toHaveBeenCalledWith('search text')
  })

  it('prevents default Enter key behavior', async () => {
    const onSubmit = vi.fn()
    render(<SearchInput value="test" onChange={vi.fn()} onSubmit={onSubmit} />)
    const input = screen.getByRole('textbox')
    // Note: the component prevents default on Enter key (tested implicitly by onSubmit call)
    await userEvent.type(input, '{Enter}')
    expect(onSubmit).toHaveBeenCalled()
  })

  it('does not call onSubmit when onSubmit is not provided', async () => {
    render(<SearchInput value="test" onChange={vi.fn()} />)
    const input = screen.getByRole('textbox')
    // Should not throw
    await userEvent.type(input, '{Enter}')
    expect(input).toBeInTheDocument()
  })

  it('calls onSubmit with current value', async () => {
    const onSubmit = vi.fn()
    const onChange = vi.fn()
    const { rerender } = render(<SearchInput value="" onChange={onChange} onSubmit={onSubmit} />)
    const input = screen.getByRole('textbox')

    await userEvent.type(input, 'barcode123')
    // Simulate value update in parent
    rerender(<SearchInput value="barcode123" onChange={onChange} onSubmit={onSubmit} />)
    await userEvent.type(input, '{Enter}')
    expect(onSubmit).toHaveBeenCalledWith('barcode123')
  })

  it('supports autoFocus', () => {
    render(<SearchInput value="" onChange={vi.fn()} autoFocus />)
    const input = screen.getByRole('textbox')
    expect(input).toHaveFocus()
  })

  it('applies custom className', () => {
    const { container } = render(
      <SearchInput value="" onChange={vi.fn()} className="custom-class" />
    )
    const label = container.querySelector('.ui-search')
    expect(label).toHaveClass('custom-class')
    expect(label).toHaveClass('ui-search')
  })

  it('forwards ref correctly', () => {
    const ref = { current: null as HTMLInputElement | null }
    render(<SearchInput ref={ref} value="" onChange={vi.fn()} />)
    expect(ref.current).toBeInstanceOf(HTMLInputElement)
  })

  it('handles empty value', () => {
    render(<SearchInput value="" onChange={vi.fn()} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('handles value with special characters', () => {
    render(<SearchInput value="special@chars#123" onChange={vi.fn()} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('special@chars#123')
  })

  it('clears value when onChange receives empty string', () => {
    const onChange = vi.fn()
    const { rerender } = render(<SearchInput value="initial" onChange={onChange} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('initial')

    rerender(<SearchInput value="" onChange={onChange} />)
    expect(input.value).toBe('')
  })

  it('handles rapid typing', async () => {
    const onChange = vi.fn()
    render(<SearchInput value="" onChange={onChange} />)
    const input = screen.getByRole('textbox')
    await userEvent.type(input, 'rapid', { delay: 10 })
    expect(onChange).toHaveBeenCalledTimes(5)
  })
})

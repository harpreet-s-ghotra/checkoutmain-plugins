import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { PriceInput } from './PriceInput'
import { normalizePriceText, priceFromText, priceToText } from './price-text'

describe('normalizePriceText', () => {
  it('places the decimal point from the right like a keypad', () => {
    expect(normalizePriceText('9')).toBe('0.09')
    expect(normalizePriceText('99')).toBe('0.99')
    expect(normalizePriceText('999')).toBe('9.99')
    expect(normalizePriceText('1250')).toBe('12.50')
  })

  it('ignores anything that is not a digit', () => {
    expect(normalizePriceText('9.99')).toBe('9.99')
    expect(normalizePriceText('$1,299.00')).toBe('1299.00')
    expect(normalizePriceText('abc')).toBe('')
  })

  it('backspacing the last character drops the last digit', () => {
    expect(normalizePriceText('9.9')).toBe('0.99')
    expect(normalizePriceText('0.9')).toBe('0.09')
    expect(normalizePriceText('0.0')).toBe('')
  })

  it('is empty for nothing or only zeros', () => {
    expect(normalizePriceText('')).toBe('')
    expect(normalizePriceText('000')).toBe('')
  })

  it('caps the number of digits', () => {
    expect(normalizePriceText('123456789012')).toBe('4567890.12')
  })
})

describe('priceToText / priceFromText', () => {
  it('round-trips a number through the field text', () => {
    expect(priceToText(9.99)).toBe('9.99')
    expect(priceToText(4.5)).toBe('4.50')
    expect(priceToText(0)).toBe('')
    expect(priceToText(undefined)).toBe('')
    expect(priceFromText('9.99')).toBe(9.99)
    expect(priceFromText('')).toBe(0)
  })
})

function Harness({ onChange }: { onChange?: (t: string) => void }): React.JSX.Element {
  const [v, setV] = useState('')
  return (
    <PriceInput
      value={v}
      onChange={(t) => {
        setV(t)
        onChange?.(t)
      }}
      aria-label="Price"
    />
  )
}

describe('PriceInput', () => {
  it('types digits into a dollar amount without needing the point', async () => {
    const user = userEvent.setup({ delay: 60 })
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const input = screen.getByLabelText('Price')
    await user.type(input, '999')
    expect(input).toHaveValue('9.99')
    expect(onChange).toHaveBeenLastCalledWith('9.99')
  })

  it('accepts a typed decimal point without doubling it', async () => {
    const user = userEvent.setup({ delay: 60 })
    render(<Harness />)
    const input = screen.getByLabelText('Price')
    await user.type(input, '12.50')
    expect(input).toHaveValue('12.50')
  })

  it('backspace removes the last digit', async () => {
    const user = userEvent.setup({ delay: 60 })
    render(<Harness />)
    const input = screen.getByLabelText('Price')
    await user.type(input, '1250')
    await user.keyboard('{Backspace}')
    expect(input).toHaveValue('1.25')
  })

  it('shows the placeholder when empty', () => {
    render(<PriceInput value="" onChange={() => {}} aria-label="Cost" />)
    expect(screen.getByLabelText('Cost')).toHaveAttribute('placeholder', '0.00')
  })
})

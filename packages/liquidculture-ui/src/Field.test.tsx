import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import { Field, Input, Select } from './Field'

describe('Field', () => {
  it('renders as a label element', () => {
    const { container } = render(
      <Field label="Test Label">
        <input />
      </Field>
    )
    const label = container.querySelector('label')
    expect(label).toBeInTheDocument()
    expect(label).toHaveClass('ui-field')
  })

  it('renders label text when provided', () => {
    render(
      <Field label="Email">
        <input />
      </Field>
    )
    expect(screen.getByText('Email')).toBeInTheDocument()
  })

  it('does not render label element when label prop is not provided', () => {
    const { container } = render(
      <Field>
        <input />
      </Field>
    )
    const labelSpan = container.querySelector('.ui-field__label')
    expect(labelSpan).not.toBeInTheDocument()
  })

  it('renders children', () => {
    render(
      <Field label="Test">
        <input data-testid="test-input" />
      </Field>
    )
    expect(screen.getByTestId('test-input')).toBeInTheDocument()
  })

  it('renders error message when provided', () => {
    render(
      <Field label="Password" error="Password is required">
        <input />
      </Field>
    )
    expect(screen.getByText('Password is required')).toBeInTheDocument()
  })

  it('renders error with error class', () => {
    const { container } = render(
      <Field label="Field" error="Error message">
        <input />
      </Field>
    )
    const errorSpan = container.querySelector('.ui-field__error')
    expect(errorSpan).toHaveClass('ui-field__error')
  })

  it('renders hint message when provided and no error', () => {
    render(
      <Field label="Username" hint="At least 3 characters">
        <input />
      </Field>
    )
    expect(screen.getByText('At least 3 characters')).toBeInTheDocument()
  })

  it('does not render hint when error is present', () => {
    render(
      <Field label="Username" hint="3 chars minimum" error="Username taken">
        <input />
      </Field>
    )
    expect(screen.getByText('Username taken')).toBeInTheDocument()
    expect(screen.queryByText('3 chars minimum')).not.toBeInTheDocument()
  })

  it('does not render message when no error or hint', () => {
    const { container } = render(
      <Field label="Field">
        <input />
      </Field>
    )
    const messageSpan = container.querySelector('.ui-field__error, .ui-field__hint')
    expect(messageSpan).not.toBeInTheDocument()
  })

  it('applies wide class when wide prop is true', () => {
    const { container } = render(
      <Field label="Wide field" wide>
        <input />
      </Field>
    )
    const field = container.querySelector('.ui-field')
    expect(field).toHaveClass('ui-field--wide')
  })

  it('does not apply wide class by default', () => {
    const { container } = render(
      <Field label="Normal field">
        <input />
      </Field>
    )
    const field = container.querySelector('.ui-field')
    expect(field).not.toHaveClass('ui-field--wide')
  })

  it('applies custom className', () => {
    const { container } = render(
      <Field label="Field" className="custom-class">
        <input />
      </Field>
    )
    const field = container.querySelector('.ui-field')
    expect(field).toHaveClass('custom-class')
    expect(field).toHaveClass('ui-field')
  })

  it('combines all classes correctly', () => {
    const { container } = render(
      <Field label="Field" wide className="extra" error="Error">
        <input />
      </Field>
    )
    const field = container.querySelector('.ui-field')
    expect(field).toHaveClass('ui-field', 'ui-field--wide', 'extra')
  })
})

describe('Input', () => {
  it('renders input element', () => {
    render(<Input data-testid="test-input" />)
    const input = screen.getByTestId('test-input')
    expect(input.tagName).toBe('INPUT')
  })

  it('applies ui-input class', () => {
    render(<Input data-testid="test-input" />)
    const input = screen.getByTestId('test-input')
    expect(input).toHaveClass('ui-input')
  })

  it('applies custom className', () => {
    render(<Input data-testid="test-input" className="custom" />)
    const input = screen.getByTestId('test-input')
    expect(input).toHaveClass('ui-input', 'custom')
  })

  it('forwards all input attributes', () => {
    render(
      <Input data-testid="test-input" type="email" placeholder="Enter email" required disabled />
    )
    const input = screen.getByTestId('test-input') as HTMLInputElement
    expect(input).toHaveAttribute('type', 'email')
    expect(input).toHaveAttribute('placeholder', 'Enter email')
    expect(input).toHaveAttribute('required')
    expect(input).toBeDisabled()
  })

  it('forwards ref correctly', () => {
    const ref = { current: null as HTMLInputElement | null }
    render(<Input ref={ref} />)
    expect(ref.current).toBeInstanceOf(HTMLInputElement)
  })

  it('handles value changes', async () => {
    render(<Input data-testid="test-input" />)
    const input = screen.getByTestId('test-input') as HTMLInputElement
    await userEvent.type(input, 'test value')
    expect(input.value).toBe('test value')
  })
})

describe('Select', () => {
  it('renders select element', () => {
    render(
      <Select data-testid="test-select">
        <option>Option 1</option>
      </Select>
    )
    const select = screen.getByTestId('test-select')
    expect(select.tagName).toBe('SELECT')
  })

  it('applies ui-input and ui-input--select classes', () => {
    render(
      <Select data-testid="test-select">
        <option>Option</option>
      </Select>
    )
    const select = screen.getByTestId('test-select')
    expect(select).toHaveClass('ui-input', 'ui-input--select')
  })

  it('applies custom className', () => {
    render(
      <Select data-testid="test-select" className="custom">
        <option>Option</option>
      </Select>
    )
    const select = screen.getByTestId('test-select')
    expect(select).toHaveClass('ui-input', 'ui-input--select', 'custom')
  })

  it('renders options', () => {
    render(
      <Select data-testid="test-select">
        <option value="1">One</option>
        <option value="2">Two</option>
        <option value="3">Three</option>
      </Select>
    )
    expect(screen.getByText('One')).toBeInTheDocument()
    expect(screen.getByText('Two')).toBeInTheDocument()
    expect(screen.getByText('Three')).toBeInTheDocument()
  })

  it('forwards all select attributes', () => {
    render(
      <Select data-testid="test-select" disabled multiple size={3}>
        <option>Option</option>
      </Select>
    )
    const select = screen.getByTestId('test-select') as HTMLSelectElement
    expect(select).toBeDisabled()
    expect(select).toHaveAttribute('multiple')
    expect(select).toHaveAttribute('size', '3')
  })

  it('forwards ref correctly', () => {
    const ref = { current: null as HTMLSelectElement | null }
    render(
      <Select ref={ref}>
        <option>Option</option>
      </Select>
    )
    expect(ref.current).toBeInstanceOf(HTMLSelectElement)
  })

  it('handles value selection', async () => {
    render(
      <Select data-testid="test-select">
        <option value="">Select</option>
        <option value="opt1">Option 1</option>
        <option value="opt2">Option 2</option>
      </Select>
    )
    const select = screen.getByTestId('test-select') as HTMLSelectElement
    await userEvent.selectOptions(select, 'opt2')
    expect(select.value).toBe('opt2')
  })

  it('works within a Field component', () => {
    render(
      <Field label="Choose option">
        <Select data-testid="test-select">
          <option>Option 1</option>
          <option>Option 2</option>
        </Select>
      </Field>
    )
    expect(screen.getByText('Choose option')).toBeInTheDocument()
    expect(screen.getByTestId('test-select')).toBeInTheDocument()
  })
})

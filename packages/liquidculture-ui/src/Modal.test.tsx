import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { AlertCircle } from 'lucide-react'
import { Modal, type ModalSize } from './Modal'
import { Button } from './Button'

describe('Modal', () => {
  it('renders with title', () => {
    render(
      <Modal title="Test Modal" onClose={vi.fn()}>
        Content
      </Modal>
    )
    expect(screen.getByText('Test Modal')).toBeInTheDocument()
  })

  it('renders modal body content', () => {
    render(
      <Modal title="Modal" onClose={vi.fn()}>
        <div>Body content</div>
      </Modal>
    )
    expect(screen.getByText('Body content')).toBeInTheDocument()
  })

  it('has proper dialog ARIA attributes', () => {
    render(
      <Modal title="Dialog Title" onClose={vi.fn()}>
        Content
      </Modal>
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('role', 'dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-label', 'Dialog Title')
  })

  it('uses ariaLabel when provided', () => {
    render(
      <Modal title="Display Title" ariaLabel="Custom ARIA Label" onClose={vi.fn()}>
        Content
      </Modal>
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-label', 'Custom ARIA Label')
  })

  it('renders close button', () => {
    render(
      <Modal title="Modal" onClose={vi.fn()}>
        Content
      </Modal>
    )
    const closeButton = screen.getByRole('button', { name: 'Close' })
    expect(closeButton).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn()
    render(
      <Modal title="Modal" onClose={onClose}>
        Content
      </Modal>
    )
    const closeButton = screen.getByRole('button', { name: 'Close' })
    await userEvent.click(closeButton)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when scrim is clicked', async () => {
    const onClose = vi.fn()
    const { container } = render(
      <Modal title="Modal" onClose={onClose}>
        Content
      </Modal>
    )
    const scrim = container.querySelector('.ui-modal__scrim')
    if (scrim) {
      await userEvent.click(scrim)
      expect(onClose).toHaveBeenCalledTimes(1)
    }
  })

  it('does not close when modal content is clicked', async () => {
    const onClose = vi.fn()
    render(
      <Modal title="Modal" onClose={onClose}>
        <div data-testid="content">Click me</div>
      </Modal>
    )
    const content = screen.getByTestId('content')
    await userEvent.click(content)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on Escape key press', async () => {
    const onClose = vi.fn()
    render(
      <Modal title="Modal" onClose={onClose}>
        Content
      </Modal>
    )
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders with all size variants', () => {
    const sizes: ModalSize[] = ['sm', 'md', 'lg', 'xl']
    sizes.forEach((size) => {
      const { unmount, container } = render(
        <Modal title="Modal" onClose={vi.fn()} size={size}>
          Content
        </Modal>
      )
      const modal = container.querySelector('.ui-modal')
      expect(modal).toHaveClass(`ui-modal--${size}`)
      unmount()
    })
  })

  it('has default md size', () => {
    const { container } = render(
      <Modal title="Modal" onClose={vi.fn()}>
        Content
      </Modal>
    )
    const modal = container.querySelector('.ui-modal')
    expect(modal).toHaveClass('ui-modal--md')
  })

  it('renders optional icon in header', () => {
    render(
      <Modal title="Modal" icon={<AlertCircle data-testid="icon" />} onClose={vi.fn()}>
        Content
      </Modal>
    )
    expect(screen.getByTestId('icon')).toBeInTheDocument()
  })

  it('renders footer when provided', () => {
    render(
      <Modal title="Modal" onClose={vi.fn()} footer={<button>Action</button>}>
        Content
      </Modal>
    )
    expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument()
  })

  it('does not render footer when not provided', () => {
    const { container } = render(
      <Modal title="Modal" onClose={vi.fn()}>
        Content
      </Modal>
    )
    const footer = container.querySelector('.ui-modal__foot')
    expect(footer).not.toBeInTheDocument()
  })

  it('focuses panel on mount', async () => {
    const { container } = render(
      <Modal title="Modal" onClose={vi.fn()}>
        Content
      </Modal>
    )
    const panel = container.querySelector('.ui-modal')
    await waitFor(() => {
      expect(panel).toHaveFocus()
    })
  })

  it('focuses child with autoFocus attribute instead of panel', async () => {
    render(
      <Modal title="Modal" onClose={vi.fn()}>
        <input autoFocus data-testid="focused-input" />
      </Modal>
    )
    const input = screen.getByTestId('focused-input')
    await waitFor(() => {
      expect(input).toHaveFocus()
    })
  })

  it('removes keydown listener on unmount', () => {
    const onClose = vi.fn()
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(
      <Modal title="Modal" onClose={onClose}>
        Content
      </Modal>
    )
    unmount()
    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    removeEventListenerSpy.mockRestore()
  })

  it('renders with complex footer', () => {
    render(
      <Modal
        title="Modal"
        onClose={vi.fn()}
        footer={
          <div>
            <button>Cancel</button>
            <button>Submit</button>
          </div>
        }
      >
        Content
      </Modal>
    )
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
  })

  it('modal structure is correct', () => {
    const { container } = render(
      <Modal title="Test Modal" icon={<AlertCircle />} onClose={vi.fn()} footer={<div>Footer</div>}>
        <div>Body</div>
      </Modal>
    )

    const scrim = container.querySelector('.ui-modal__scrim')
    const modal = container.querySelector('.ui-modal')
    const header = container.querySelector('.ui-modal__head')
    const body = container.querySelector('.ui-modal__body')
    const footer = container.querySelector('.ui-modal__foot')

    expect(scrim).toBeInTheDocument()
    expect(modal).toBeInTheDocument()
    expect(header).toBeInTheDocument()
    expect(body).toBeInTheDocument()
    expect(footer).toBeInTheDocument()

    // Verify hierarchy
    expect(scrim?.contains(modal)).toBe(true)
    expect(modal?.contains(header)).toBe(true)
    expect(modal?.contains(body)).toBe(true)
    expect(modal?.contains(footer)).toBe(true)
  })

  it('handles multiple escape presses', async () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <Modal title="Modal" onClose={onClose}>
        Content
      </Modal>
    )

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)

    // Re-render to simulate modal staying open or reopening
    rerender(
      <Modal title="Modal" onClose={onClose}>
        Content
      </Modal>
    )

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('renders with react fragments as children', () => {
    render(
      <Modal title="Modal" onClose={vi.fn()}>
        <>
          <div>First</div>
          <div>Second</div>
        </>
      </Modal>
    )
    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
  })

  describe('Enter accepts', () => {
    const footer = (onSave: () => void, disabled = false): React.ReactNode => (
      <>
        <Button variant="ghost" onClick={vi.fn()}>
          Cancel
        </Button>
        <Button disabled={disabled} onClick={onSave}>
          Save
        </Button>
      </>
    )

    it('presses the primary footer button', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      render(
        <Modal title="M" onClose={vi.fn()} footer={footer(onSave)}>
          Body
        </Modal>
      )
      await user.keyboard('{Enter}')
      expect(onSave).toHaveBeenCalledTimes(1)
    })

    it('does nothing while the primary button is disabled', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      render(
        <Modal title="M" onClose={vi.fn()} footer={footer(onSave, true)}>
          Body
        </Modal>
      )
      await user.keyboard('{Enter}')
      expect(onSave).not.toHaveBeenCalled()
    })

    it('never presses a danger button', async () => {
      const user = userEvent.setup()
      const onDelete = vi.fn()
      render(
        <Modal
          title="M"
          onClose={vi.fn()}
          footer={
            <Button variant="danger" onClick={onDelete}>
              Delete
            </Button>
          }
        >
          Body
        </Modal>
      )
      await user.keyboard('{Enter}')
      expect(onDelete).not.toHaveBeenCalled()
    })

    it('leaves Enter to a text field (a scanner ends codes with Enter)', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      render(
        <Modal title="M" onClose={vi.fn()} footer={footer(onSave)}>
          <input aria-label="Barcode" />
        </Modal>
      )
      await user.click(screen.getByLabelText('Barcode'))
      await user.keyboard('123{Enter}')
      expect(onSave).not.toHaveBeenCalled()
    })

    it('leaves Enter to a keypad inside the dialog', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      render(
        <Modal title="M" onClose={vi.fn()} footer={footer(onSave)}>
          <div className="keypad-entry" />
        </Modal>
      )
      await user.keyboard('{Enter}')
      expect(onSave).not.toHaveBeenCalled()
    })

    it('only the top dialog answers', async () => {
      const user = userEvent.setup()
      const under = vi.fn()
      const top = vi.fn()
      render(
        <>
          <Modal title="Under" onClose={vi.fn()} footer={footer(under)}>
            Body
          </Modal>
          <Modal title="Top" onClose={vi.fn()} footer={footer(top)}>
            Body
          </Modal>
        </>
      )
      await user.keyboard('{Enter}')
      expect(top).toHaveBeenCalledTimes(1)
      expect(under).not.toHaveBeenCalled()
    })
  })
})

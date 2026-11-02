import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { Tabs, type TabItem } from './Tabs'

describe('Tabs', () => {
  const defaultTabs: TabItem<'items' | 'categories'>[] = [
    { value: 'items', label: 'Items' },
    { value: 'categories', label: 'Categories' }
  ]

  it('renders as a tablist', () => {
    const { container } = render(
      <Tabs items={defaultTabs} value="items" onChange={vi.fn()} ariaLabel="Navigation" />
    )
    const tablist = container.querySelector('[role="tablist"]')
    expect(tablist).toBeInTheDocument()
    expect(tablist).toHaveClass('ui-tabs')
  })

  it('applies aria-label to tablist', () => {
    const { container } = render(
      <Tabs items={defaultTabs} value="items" onChange={vi.fn()} ariaLabel="Main tabs" />
    )
    const tablist = container.querySelector('[role="tablist"]')
    expect(tablist).toHaveAttribute('aria-label', 'Main tabs')
  })

  it('renders all tabs', () => {
    render(<Tabs items={defaultTabs} value="items" onChange={vi.fn()} ariaLabel="Tabs" />)
    expect(screen.getByRole('tab', { name: 'Items' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Categories' })).toBeInTheDocument()
  })

  it('marks active tab with --on class and aria-selected', () => {
    render(<Tabs items={defaultTabs} value="items" onChange={vi.fn()} ariaLabel="Tabs" />)
    const itemsTab = screen.getByRole('tab', { name: 'Items' })
    const categoriesTab = screen.getByRole('tab', { name: 'Categories' })

    expect(itemsTab).toHaveClass('ui-tabs__tab--on')
    expect(itemsTab).toHaveAttribute('aria-selected', 'true')

    expect(categoriesTab).not.toHaveClass('ui-tabs__tab--on')
    expect(categoriesTab).toHaveAttribute('aria-selected', 'false')
  })

  it('updates aria-selected when value changes', () => {
    const { rerender } = render(
      <Tabs items={defaultTabs} value="items" onChange={vi.fn()} ariaLabel="Tabs" />
    )
    let itemsTab = screen.getByRole('tab', { name: 'Items' })
    expect(itemsTab).toHaveAttribute('aria-selected', 'true')

    rerender(<Tabs items={defaultTabs} value="categories" onChange={vi.fn()} ariaLabel="Tabs" />)
    itemsTab = screen.getByRole('tab', { name: 'Items' })
    const categoriesTab = screen.getByRole('tab', { name: 'Categories' })
    expect(itemsTab).toHaveAttribute('aria-selected', 'false')
    expect(categoriesTab).toHaveAttribute('aria-selected', 'true')
  })

  it('calls onChange when tab is clicked', async () => {
    const onChange = vi.fn()
    render(<Tabs items={defaultTabs} value="items" onChange={onChange} ariaLabel="Tabs" />)
    const categoriesTab = screen.getByRole('tab', { name: 'Categories' })
    await userEvent.click(categoriesTab)
    expect(onChange).toHaveBeenCalledWith('categories')
  })

  it('renders with icon', () => {
    const tabsWithIcon: TabItem<'success' | 'alert'>[] = [
      { value: 'success', label: 'Success', icon: CheckCircle2 },
      { value: 'alert', label: 'Alert', icon: AlertCircle }
    ]
    const { container } = render(
      <Tabs items={tabsWithIcon} value="success" onChange={vi.fn()} ariaLabel="Status tabs" />
    )
    const icons = container.querySelectorAll('svg')
    expect(icons.length).toBeGreaterThanOrEqual(2)
  })

  it('renders icon with aria-hidden', () => {
    const tabsWithIcon: TabItem<'home'>[] = [{ value: 'home', label: 'Home', icon: CheckCircle2 }]
    const { container } = render(
      <Tabs items={tabsWithIcon} value="home" onChange={vi.fn()} ariaLabel="Tabs" />
    )
    const icon = container.querySelector('svg')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders count badge when count is provided and > 0', () => {
    const tabsWithCount: TabItem<'messages' | 'archive'>[] = [
      { value: 'messages', label: 'Messages', count: 5 },
      { value: 'archive', label: 'Archive', count: 0 }
    ]
    render(<Tabs items={tabsWithCount} value="messages" onChange={vi.fn()} ariaLabel="Tabs" />)
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('does not render count when count is 0', () => {
    const tabsWithCount: TabItem<'inbox'>[] = [{ value: 'inbox', label: 'Inbox', count: 0 }]
    render(<Tabs items={tabsWithCount} value="inbox" onChange={vi.fn()} ariaLabel="Tabs" />)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('does not render count when count is undefined', () => {
    const tabsNoCount: TabItem<'tab1'>[] = [{ value: 'tab1', label: 'Tab 1' }]
    const { container } = render(
      <Tabs items={tabsNoCount} value="tab1" onChange={vi.fn()} ariaLabel="Tabs" />
    )
    const countSpan = container.querySelector('.ui-tabs__count')
    expect(countSpan).not.toBeInTheDocument()
  })

  it('applies count class tnum', () => {
    const tabsWithCount: TabItem<'count'>[] = [{ value: 'count', label: 'Count', count: 42 }]
    const { container } = render(
      <Tabs items={tabsWithCount} value="count" onChange={vi.fn()} ariaLabel="Tabs" />
    )
    const countSpan = container.querySelector('.ui-tabs__count')
    expect(countSpan).toHaveClass('tnum')
  })

  it('applies custom className to tabs container', () => {
    const { container } = render(
      <Tabs
        items={defaultTabs}
        value="items"
        onChange={vi.fn()}
        ariaLabel="Tabs"
        className="custom-class"
      />
    )
    const tablist = container.querySelector('.ui-tabs')
    expect(tablist).toHaveClass('custom-class')
  })

  it('renders tabs with complex labels', () => {
    const complexTabs: TabItem<'left' | 'right'>[] = [
      { value: 'left', label: 'Left side items' },
      { value: 'right', label: 'Right side items' }
    ]
    render(<Tabs items={complexTabs} value="left" onChange={vi.fn()} ariaLabel="Layout" />)
    expect(screen.getByRole('tab', { name: 'Left side items' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Right side items' })).toBeInTheDocument()
  })

  it('handles single tab', () => {
    const singleTab: TabItem<'only'>[] = [{ value: 'only', label: 'Only Tab' }]
    render(<Tabs items={singleTab} value="only" onChange={vi.fn()} ariaLabel="Tabs" />)
    expect(screen.getByRole('tab', { name: 'Only Tab' })).toBeInTheDocument()
  })

  it('handles many tabs', () => {
    const manyTabs: TabItem<'a' | 'b' | 'c' | 'd' | 'e'>[] = [
      { value: 'a', label: 'Tab A' },
      { value: 'b', label: 'Tab B' },
      { value: 'c', label: 'Tab C' },
      { value: 'd', label: 'Tab D' },
      { value: 'e', label: 'Tab E' }
    ]
    render(<Tabs items={manyTabs} value="a" onChange={vi.fn()} ariaLabel="Many tabs" />)
    for (const tab of manyTabs) {
      expect(screen.getByRole('tab', { name: tab.label })).toBeInTheDocument()
    }
  })

  it('all tabs have type="button"', () => {
    render(<Tabs items={defaultTabs} value="items" onChange={vi.fn()} ariaLabel="Tabs" />)
    const tabs = screen.getAllByRole('tab')
    tabs.forEach((tab) => {
      expect(tab).toHaveAttribute('type', 'button')
    })
  })

  it('renders tabs in order', () => {
    render(<Tabs items={defaultTabs} value="items" onChange={vi.fn()} ariaLabel="Tabs" />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveTextContent('Items')
    expect(tabs[1]).toHaveTextContent('Categories')
  })

  it('handles rapid tab changes', async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <Tabs items={defaultTabs} value="items" onChange={onChange} ariaLabel="Tabs" />
    )
    const categoriesTab = screen.getByRole('tab', { name: 'Categories' })
    await userEvent.click(categoriesTab)
    expect(onChange).toHaveBeenCalledWith('categories')

    rerender(<Tabs items={defaultTabs} value="categories" onChange={onChange} ariaLabel="Tabs" />)
    const itemsTab = screen.getByRole('tab', { name: 'Items' })
    await userEvent.click(itemsTab)
    expect(onChange).toHaveBeenCalledWith('items')
  })

  it('renders tab with icon and count', () => {
    const tabsWithBoth: TabItem<'notifications'>[] = [
      { value: 'notifications', label: 'Notifications', icon: AlertCircle, count: 3 }
    ]
    render(<Tabs items={tabsWithBoth} value="notifications" onChange={vi.fn()} ariaLabel="Tabs" />)
    // The tab name includes the count since it's part of the text content
    expect(screen.getByRole('tab', { name: /Notifications/ })).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('focuses tab on click', async () => {
    render(<Tabs items={defaultTabs} value="items" onChange={vi.fn()} ariaLabel="Tabs" />)
    const categoriesTab = screen.getByRole('tab', { name: 'Categories' })
    await userEvent.click(categoriesTab)
    expect(categoriesTab).toHaveFocus()
  })
})

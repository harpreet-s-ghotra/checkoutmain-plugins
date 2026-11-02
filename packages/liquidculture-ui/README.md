# @checkoutmain/liquidculture-ui

**Retail Precision**: the component library and design tokens of the
LiquidCulture point-of-sale, for React. Plain CSS with BEM naming and CSS
custom properties. No Tailwind, no CSS-in-JS, no runtime theme engine. Built
for a touch screen behind a counter: every target 48 px or taller, prices in
tabular figures, one motion in the whole system.

```tsx
import '@checkoutmain/liquidculture-ui/tokens.css'
import '@checkoutmain/liquidculture-ui/base.css'
import { Button, Field, Input, PriceInput, Modal, Badge } from '@checkoutmain/liquidculture-ui'

function EditItem({ onClose, onSave }) {
  const [price, setPrice] = useState('')
  return (
    <Modal
      title="Edit item"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSave}>Save changes</Button>
        </>
      }
    >
      <Field label="Name">
        <Input defaultValue="Ginger Kombucha" />
      </Field>
      <Field label="Price">
        <PriceInput value={price} onChange={setPrice} />
      </Field>
      <Badge tone="success">In stock</Badge>
    </Modal>
  )
}
```

Load **Inter** (400/500/600/700) yourself; `base.css` asks for it first and
falls back to the system face.

## Brand and style

Engineered for high-velocity retail where speed and accuracy are paramount. The
personality is authoritative, reliable, utilitarian: functional clarity over
decorative flair. A structured grid, clear hierarchy, and deliberate colour that
guides the operator's eye to the one critical action. Prices, quantities and
status are unmistakable at a glance, so the screen costs nothing to read during
a rush.

## Design tokens (`tokens.css`)

Every value is a CSS custom property on `:root`; components only ever say
`var(--token)`. Never a raw hex in a component.

| Group       | Tokens                                                                                                                               | Use                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Surfaces    | `--bg`, `--surface-bright`, `--surface-lowest`, `--surface-low`, `--surface`, `--surface-high`, `--surface-highest`, `--surface-dim` | Tonal depth, light to dim. Cards sit on `--surface-lowest`.                 |
| Text        | `--on-surface`, `--on-surface-variant`                                                                                               | Primary text, labels and secondary text                                     |
| Lines       | `--outline`, `--outline-variant`                                                                                                     | Borders on interactive elements; hairline dividers                          |
| Primary     | `--primary` (navy), `--on-primary`, `--primary-container`, `--on-primary-container`                                                  | Frame, navigation, admin actions, Save                                      |
| Success     | `--success` (green), `--on-success`, `--success-container`, `--on-success-container`                                                 | High-intent tender: Pay, Charge, Complete Sale                              |
| Accent      | `--accent` (amber), `--accent-container`, `--on-accent-container`                                                                    | Alerts, pending, weighed-item or age-check flags                            |
| Danger      | `--danger` (red), `--on-danger`, `--danger-container`, `--on-danger-container`                                                       | Void, delete, cancel                                                        |
| Tag palette | `--tag-1-bg` … `--tag-6-bg`, `--tag-1-fg` … `--tag-6-fg`                                                                             | Category tags and chips: soft background, readable ink                      |
| Radius      | `--r-sm` 2px, `--r` 4px, `--r-md` 6px, `--r-lg` 8px, `--r-xl` 12px, `--r-2xl` 20px, `--r-full`                                       | Soft: 4px for buttons, inputs, tiles; 8px containers; pills are status only |
| Spacing     | `--touch-min` 48px, `--gap-cart` 4px, `--gap-tile` 12px, `--pad-container` 24px                                                      | No interactive element smaller than `--touch-min`                           |

## Type scale (`base.css`)

Inter only. `font-variant-numeric: tabular-nums` on every price and quantity so
columns align (`.tnum`). Heavy weights for data that changes (the running
total), light for static labels. Button labels use `label-xl` to stay legible
at arm's length.

| Class                 | Size / line | Weight | Use                                     |
| --------------------- | ----------- | ------ | --------------------------------------- |
| `.type-display-price` | 48 / 48     | 700    | Running total, payment amount           |
| `.type-headline-lg`   | 32 / 40     | 700    | Screen titles                           |
| `.type-headline-md`   | 24 / 32     | 600    | Panel headings                          |
| `.type-body-lg`       | 18 / 28     | 500    | Tile labels                             |
| `.type-body-md`       | 16 / 24     | 400    | Body copy                               |
| `.type-label-xl`      | 20 / 24     | 700    | Primary button labels (0.05em tracking) |
| `.type-label-md`      | 14 / 20     | 600    | Secondary labels, price badges          |
| `.type-mono-data`     | 16 / 24     | 600    | Inline numeric data (SKU, qty, cost)    |

`base.css` also carries the reset (border-box, no margins, buttons inherit
their font), a `:focus-visible` ring in `--primary`, and the drag-scroll cursor
state.

## Elevation, shape, motion

- **Flat layering.** Depth comes from tonal contrast, not shadows: the cart and
  the rail sit on slightly lighter or darker surfaces than the canvas. Cards and
  tiles use a `1px var(--outline-variant)` border instead of a shadow.
- **One motion.** A pressed tile sinks (`transform: scale(0.98)`) or switches
  its border to `--primary`. Everything else is instant; the register must
  never feel like it is waiting on an animation.
- **Soft 4px** corners for standard elements, 8px for containers, full pills
  for status indicators only, never for anything clickable.
- **Modals** isolate critical tasks behind a 60% scrim. Enter accepts the
  dialog's primary action so a USB numeric keypad can run the register;
  destructive confirms stay tap-only.

## Components

| Need                               | Component     | Notes                                                                                                                                                                                    |
| ---------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any standard button                | `Button`      | `variant`: primary (navy) · success (green, tender only) · secondary (outline) · danger · ghost · neutral. `size`: sm · md · lg; md+ meet the 48px floor. `block` stretches.             |
| Label + control + error / hint     | `Field`       | Renders a `<label>`; `wide` spans a two-column grid                                                                                                                                      |
| Text input                         | `Input`       | Boxed, `1px var(--outline)`, focus thickens to `2px var(--primary)`; forwards ref and every input prop                                                                                   |
| Dropdown                           | `Select`      | Styled chevron; forwards ref and every select prop                                                                                                                                       |
| Price / cost / cash amount         | `PriceInput`  | Types like a register keypad: digits fill in from the right, the point is placed for you ("999" → 9.99). `priceToText` / `priceFromText` bridge number state                             |
| Search box (icon + input pill)     | `SearchInput` | `value` / `onChange(value)`; `onSubmit` fires on Enter, which is how a scanner types                                                                                                     |
| Either / or toggle                 | `Segmented`   | `options` / `value` / `onChange`, generic over the value type                                                                                                                            |
| Screen section tabs                | `Tabs`        | `items` / `value` / `onChange`; icon + count pill; underline on the active tab                                                                                                           |
| Checkbox with label + description  | `Checkbox`    | `boxed` wraps it in a tappable card                                                                                                                                                      |
| Status pill (state, not clickable) | `Badge`       | `tone`: success · warning · danger · info · neutral                                                                                                                                      |
| Category tag                       | `Tag`         | `tint` 1–6 from the tag palette, by category order                                                                                                                                       |
| Rounded icon container             | `IconTile`    | `tone`: primary (navy) · subtle; `size`                                                                                                                                                  |
| Modal / dialog                     | `Modal`       | Scrim + header (icon · title · close) + body + `footer`; Esc and the scrim close it; Enter presses the enabled primary footer button (never danger, not from a text field); `size` sm–xl |
| Conditional classNames             | `cn()`        | `clsx` under a short name                                                                                                                                                                |

Only a modal's inner content gets bespoke CSS; the shell, header and footer
never do. Extend components through props, not by copying their CSS into a
screen's stylesheet.

### Anti-patterns

- `<button className="…">` for a standard action → `Button`.
- `<input className="…">` or `<select>` → `Input` / `Select` inside a `Field`.
- `<Input type="number" step="0.01">` for a dollar amount → `PriceInput`.
- A new scrim + panel for a dialog → `Modal`.
- A hand-rolled status pill, category badge, segmented toggle or icon box →
  `Badge` / `Tag` / `Segmented` / `IconTile`.

## Rules

- Tokens first: always `var(--token)`, never a raw hex in a component's CSS.
- Concentric CSS property order in every stylesheet: position → box → border /
  background → typography → other.
- No animation beyond the `scale(0.98)` press and the modal scrim.
- No emojis in the UI; icons are `lucide-react`.
- No Tailwind, no CSS-in-JS for static styles.

## Not here

The pieces that belong to a register, not to a library, stay in the POS: the
on-screen number pad and keypad entry, the on-screen keyboard, the Code 128
barcode, the scanner capture hook, the product tile and the cart line. They
are built from these primitives and tokens.

## Peer dependencies

`react` and `react-dom` 18 or newer, `lucide-react` for the icons the
components use (close, search, alert, check), `clsx`.

## Tests

`npm test` from the repo root runs the component tests under jsdom with
Testing Library: every component's variants, the keypad maths behind
`PriceInput`, Enter and Esc handling in `Modal`, keyboard flow through
`Segmented` and `Tabs`.

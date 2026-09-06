# @checkoutmain/keyboard-wedge-scanner

Most USB and Bluetooth barcode scanners are "keyboard wedges": they type the
code as fast keystrokes and press Enter. This package tells those bursts apart
from a human typing, with no configuration on the scanner side.

```tsx
import { useKeyboardWedge } from '@checkoutmain/keyboard-wedge-scanner'

function Register() {
  useKeyboardWedge((code) => addToCart(code))
  return <Cart />
}
```

Or as a component, mounted once near the top of a screen:

```tsx
import { ScannerCapture } from '@checkoutmain/keyboard-wedge-scanner'

;<ScannerCapture onScan={addToCart} enabled={!modalOpen} />
```

**Peer dependency:** `react >= 18` — only for the hook/component. The parser
has no dependencies at all.

## How it works

`parseScannerInput` is a tiny state machine fed one event at a time:

- A `char` event within `intervalMs` (default **50ms**) of the previous one
  extends the buffer. A longer gap **resets** the buffer first.
- A `flush` event (Enter) returns the buffer if it is at least `minLength`
  (default **3**) characters, else `null`.

Human typing is filtered by timing alone. A person cannot hold the inter-key
gap under 50ms across a whole code, so their buffer keeps resetting and never
reaches `minLength` by the time Enter arrives. There is no prefix/suffix
configuration and no scanner-side programming sheet.

The hook wires this to `keydown` on `document` and:

- ignores keystrokes whose target is an `<input>`, `<textarea>`, or
  `contentEditable` element (so a scan never lands while someone is typing in
  a field — set `ignoreEditable: false` to change that),
- ignores modifier combos and non-printing keys,
- calls `event.preventDefault()` on the Enter that completes a scan, so it does
  not also submit a form.

## Options

| Option           | Default    | Notes                                      |
| ---------------- | ---------- | ------------------------------------------ |
| `enabled`        | `true`     | Detach while a modal owns the keyboard.    |
| `intervalMs`     | `50`       | Raise to ~100 for slow Bluetooth scanners. |
| `minLength`      | `3`        |                                            |
| `ignoreEditable` | `true`     |                                            |
| `target`         | `document` | Listen on a specific element instead.      |

## Pairing with the camera scanner

Camera decoders report UPC-A as EAN-13 with a leading zero; a wedge scanner
emits the 12 digits printed under the bars. If you use both, normalise on the
way in — `normalizeScannedCode` from `@checkoutmain/camera-barcode-scanner`,
or `canonicalGtin` from `@checkoutmain/barcode-gtin` — so both paths store and
match the same string.

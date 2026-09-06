# @checkoutmain/barcode-gtin

One product, several printed barcodes. A 187ml bottle carries a compressed
8-digit **UPC-E**; the same product's shelf tag and case carry the full
12-digit **UPC-A**; a camera decoder hands you a 13-digit **EAN-13** with a
leading zero; and some import somewhere dropped that zero and stored 11 digits.
A lookup that compares strings finds none of them.

This package closes that gap. No dependencies.

```ts
import { barcodeLookupVariants, canonicalGtin } from '@checkoutmain/barcode-gtin'

// Querying stored strings you cannot rewrite: match ANY form.
const rows = await db.products.whereIn('barcode', barcodeLookupVariants(scanned))

// You control the schema: store the canonical form once, compare that.
await db.products.insert({ barcode_canonical: canonicalGtin(scanned), ... })
```

## API

### `expandUpcE(code) → string | null`

8-digit UPC-E → 12-digit UPC-A, or `null` if `code` is not a valid UPC-E.
UPC-E carries the UPC-A's check digit unchanged, so the expansion is verified
by recomputing the check — which is what stops a random 8-digit internal SKU
from being mistaken for a barcode.

### `compressToUpcE(upca) → string | null`

12-digit UPC-A → 8-digit UPC-E, or `null` when it has no compressed form
(most UPC-As do not). This is the direction that is easy to miss: ZXing hands
back the _expanded_ code for a UPC-E symbol, so a lookup arrives holding a
UPC-A and has to find a row stored as UPC-E.

Rather than invert the digit shuffling by hand, each of the four UPC-E layouts
produces a candidate and only the one that expands back to exactly this UPC-A
is accepted. The round trip is the proof; a wrong candidate cannot escape.

### `canonicalGtin(code) → string`

UPC-E expanded, leading zeros stripped. Non-numeric codes are trimmed and
returned as-is. Use this as your stored comparison key.

### `barcodeLookupVariants(code) → string[]`

Every string this code could have been stored as:

| Form          | Example         | Where it comes from                   |
| ------------- | --------------- | ------------------------------------- |
| as scanned    | `0085200000258` | whatever the device handed you        |
| zero-stripped | `85200000258`   | imports that dropped the leading zero |
| UPC-A (12)    | `085200000258`  | shelf tags, cases, wedge scanners     |
| EAN-13 (13)   | `0085200000258` | camera decoders                       |
| UPC-E (8)     | `08502528`      | what a small bottle actually carries  |

Non-numeric codes (`NB-1234`, keyed SKUs) come back as a single-element
array — none of this applies to them.

### `upcaCheckDigit(body) → number`

Modulo-10 check digit for an 11-digit UPC-A body or a 12-digit EAN-13 body.

## Tests

The test vectors are real retail barcodes: thirteen Sutter Home 187ml minis
whose UPC-E and UPC-A forms were both observed in production. All four UPC-E
digit layouts are covered with _derived_ vectors (check digit computed, not
typed) so a typo cannot silently turn a case into "not a UPC-E" and pass
vacuously.

# @checkoutmain/pax-terminal

Drive a PAX card terminal from Node over the local network. The terminal reads
the card and talks to the processor; your software only ever says "charge
$38.10" and gets back last four, brand, a durable reference and whether a PIN
was entered. Card data never touches your process, and the merchant's processor
credentials live on the terminal, so there is nothing to vault.

This is the POSLink **semi-integrated** protocol over TCP (port 10009), as
spoken by PAX terminals running the **Fiserv / First Data RapidConnect**
application. Every byte of it below was confirmed against live terminals in
stores, and the tests carry a real approval frame as a vector.

```ts
import {
  createPaxTerminal,
  PaxNoAnswerError,
  PaxTerminalBusyError
} from '@checkoutmain/pax-terminal'

const terminal = createPaxTerminal({ host: '192.168.1.50' })

const result = await terminal.sale({ cents: 3810 })
if (result.success) {
  // result.reference  → keep it: refunds and voids need it
  // result.lastFour, result.cardBrand, result.tenderType ('credit' | 'debit')
  // result.approvedCents — on a partial approval, LESS than 3810; record this
} else {
  // result.message — "DECLINE", "TIMEOUT", "ABORTED" …
}

await terminal.refund(result.reference, 1000) // partial RETURN against that sale
await terminal.voidSale(result.reference) // VOID, same day
await terminal.standaloneCredit({ cents: 500 }) // RETURN with no original: no-receipt returns
await terminal.test() // { ok, message } — a TCP connect, no bytes sent
```

**No dependencies.** Node ≥ 18 (`net`, `Buffer`). Works in an Electron main
process, a Node service, a script.

## What you get

| Method                        | Policy when the terminal is busy     | What it does                                                                                                                    |
| ----------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `sale({ cents, retryOf? })`   | **refused** (`PaxTerminalBusyError`) | DoCredit SALE (`T00`/`01`). Prompts the customer. Recovers a sale the terminal accepted but never answered (below).             |
| `standaloneCredit({ cents })` | **refused**                          | RETURN (`02`) with a fresh reference and no original. The terminal prompts for a card and credits it.                           |
| `refund(reference, cents)`    | **waits** its turn                   | RETURN against a prior sale, partial or full.                                                                                   |
| `voidSale(reference)`         | **waits**                            | VOID (`11`) a prior sale.                                                                                                       |
| `test()`                      | **skipped** (`{ skipped: true }`)    | Reachability: TCP connect, closed as soon as it opens. For a status light and a Test button.                                    |
| `checkSaleLookup(trigger?)`   | **background** — only when idle      | Proves the recovery lookup works on this terminal using the last good sale. Runs itself once a day; call it for a Check button. |
| `isBusy()`                    |                                      |                                                                                                                                 |

Every method that sends a request resolves with a `PaxChargeResult`. A decline
is a **result** (`success: false`), not an exception. Exceptions mean the
terminal was not heard from: unreachable (an `Error` naming `host:port`), busy
(`PaxTerminalBusyError`, nothing was sent), or accepted-then-silent
(`PaxNoAnswerError` — the outcome is genuinely unknown; see recovery).

Amounts are **integer cents** everywhere.

## The parts that took a terminal to learn

The source comments record each of these in full; this is the index.

**Requests have no leading packet field, responses do.** The terminal prefixes
its answer with `"0" FS` (`STX 0 FS T01 …`). Put that on a request and the
terminal rejects it outright — no NAK, no ACK, nothing.

**Protocol version must match the terminal's app.** `1.58` for RapidConnect.
Send another and later fields are misparsed ("TRANS TYPE NULL").

**Amount is plain cents.** `1102`, not `000000001102`. The terminal pads for the
host; padded here it answers "AMOUNT INVALID".

**The finalize ACK has to reach the wire.** After a response the ECR sends one
`0x06`, and that byte is the only thing that tells the terminal the sale is
done. Node's `socket.destroy()` drops queued writes, so an ACK written and
destroyed in the same tick never arrives and the terminal stays "armed",
showing the amount, after a charge that approved. The ACK is written, its
callback awaited (bounded at 2 s), and only then is the socket torn down. If it
cannot be flushed the sale still stands — the host hears about it through the
`finalize` report event.

**Fail fast while connecting, wait long once connected.** 5 s to connect
(a terminal that is on answers in milliseconds; the OS default is ~21 s), then
75 s for the transaction. The customer is at the card prompt for most of that;
over 6,767 production approvals the slowest took 71 s and p99 was 36 s. A
`timeout_ms` override is floored at 60 s because a socket that gives up while
the terminal is mid-transaction is the one failure whose outcome is unknown.

**Brand is not where the layout says.** `AccountInformation[2]` is the expiry,
not the card type. Brand comes from `CARDBIN` in AdditionalInformation — and on
credit approvals this host leaves `CARDBIN` empty, so it falls back to the EMV
`APPLAB` / `APPNAME` ("VISA CREDIT", "CHASE VISA").

**Credit or debit is what the terminal did, not what the cashier pressed.**
`tenderType` is `'debit'` when a PIN was entered (`PINSTATUSNUM` non-zero or
`CVM` 1/2) and `'credit'` otherwise. A debit card run under a "Credit" key that
prompted for a PIN is debit.

**A partial approval is money, not a decline.** A prepaid card with $20 on it
rung for $27.22 comes back `000002 PARTIALLY APPROVED`, host `002 APPRV LESSER
AMT`, ApproveAmount 1891, AmountDue 831. Treat that as a decline and the
customer has been charged $18.91 while the register shows $27.22 still owing.
`parseResponse` detects a partial from the **amounts** (so it holds however a
host spells it) and returns `success: true, partial: true, approvedCents: 1891,
amountDueCents: 831`.

**`GLOBALUID` is the reference that lasts.** It is present on approvals and
declines alike and is what RETURN and VOID take. Falls back to the host
reference, then the trace reference.

## One command on the terminal at a time

A PAX is a single-connection device. In production, a 30-second status poll
that opened its own TCP connection landed in the middle of roughly one charge
in four, and nothing stopped a second sale from being sent while the first was
still prompting. Every command here runs through a lock, one per `host:port`,
shared by every `createPaxTerminal` handle in the process:

- a **sale** or **standalone credit** is refused while anything else is open —
  queuing it would prompt the customer for a second card the moment the first
  finished, which is a double charge in waiting;
- a **refund** or **void** waits its turn — it is always a deliberate reversal;
- the **lookup check** runs only when idle and never makes a sale refuse: a
  sale arriving during one waits a second behind it;
- a **probe** never waits and never overlaps: skipped while a command is open,
  and torn down if it is still connecting when one starts.

`createTerminalLock()` is exported on its own if you have other traffic to the
same device.

## A sale the terminal accepted and never answered

Rare, and the worst failure a register has: the terminal ACKs the sale,
approves it, and never sends the response. The socket times out, the register
says "try again", and the card has already been charged. Seen twice in
2.5 months on one terminal, both times right after a failed attempt was retried.

When the timeout arrives after an ACK and before any `STX`, `sale` does not give
up. Still holding the lock, so nothing else reaches the terminal in between, it
asks the terminal's batch — up to three rounds, 10 s each, 2 s apart:

1. **LocalDetailReport by our reference** (`R02` with the ECR reference in
   field 8). Taken only when the report succeeded, holds exactly one record,
   that record carries our reference, the host code is `000` and the full
   amount was approved.
2. **The newest record in the batch**, for terminals that answer `100023 NOT
FOUND` to every reference lookup (some do; others find it fine). The record
   the terminal returns with no filter, plus the last by position counted from
   either end (which end is not documented). Taken only when every check
   passes: host `000`, a SALE, the exact amount, not another of our references,
   a `GLOBALUID` not already known (see `isKnownReference`), and a terminal
   timestamp no earlier than five minutes before the sale was sent. A record
   with no timestamp is never taken.

A recovered record is rewritten as the `T01` the sale should have received and
parsed exactly like a live approval. Anything else leaves the sale **unknown**
— `PaxNoAnswerError`, never a decline — with `error.ecrRef` set.

**Retrying the payment.** Keep that `ecrRef` with the open payment (not across
payments) and pass it back as `retryOf` when the cashier presses Card again:

```ts
let unresolved: string | undefined
try {
  return await terminal.sale({ cents, retryOf: unresolved })
} catch (err) {
  if (err instanceof PaxNoAnswerError && err.ecrRef) unresolved = err.ecrRef
  throw err
}
```

The terminal is asked about that sale first — by now it has certainly finished
it — and charged again only if it holds no approval. A reference is looked up
once, only for the same amount, and the register's own copy of it is dropped
after, so a later customer paying the same total can never take an earlier
approval.

**Proving it before you need it.** Five seconds after the first full approval
of the day the terminal runs `checkSaleLookup('daily')`: it asks for that sale
and compares `GLOBALUID` and last four with what came back live. The result is
one of `works`, `works-recent` (found by newest record, not by reference — this
terminal is the second kind), `mismatch`, `not-found`, `no-answer`. Anything but
`works` is reported with every answer the terminal gave, so the first time a
sale goes silent you already know which lookup this terminal honours.

## Hooks: what the host provides

All optional. Each is wrapped so an exception in it can never become a failure
to charge.

```ts
const terminal = createPaxTerminal(
  { host, port, timeout_ms },
  {
    log: { debug, info, warn, error }, // default: silent. debug carries request/response hex.
    report: (event) => queueSupportRow(event), // see PaxReportEvent
    metric: (name, label) => counters.inc(name, label), // ('pax_lookup_check', 'works')
    isKnownReference: (uid) => db.hasCardSale(uid), // a batch record is never a sale you already have
    ecrPrefix: 'ECR', // ECR000123 — prefix + six digits
    timing: {
      connectTimeoutMs,
      recoveryAttempts,
      recoveryTimeoutMs,
      recoveryGapMs,
      lookupCheckDelayMs
    }
  }
)
```

`report` is a **failure channel**, not analytics: a clean full approval emits
nothing. Events, each with `terminal: 'host:port'` and `requestedCents`:

| `stage`        | When                                                    | Carries                                                       |
| -------------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| `response`     | the terminal answered with a decline or a partial       | `operation`, `kind`, the parsed `summary` (no PAN, ever)      |
| `error`        | nothing to inspect: unreachable, timed out, corrupt     | `operation`, `kind: 'unreachable' \| 'protocol'`, `error`     |
| `finalize`     | approved, but the ACK did not flush                     | `operation`, `error`                                          |
| `recovery`     | a silent sale was looked up                             | `ecrRef`, `recovered`, `trigger`, one line per `lookups`      |
| `lookup-check` | the daily / manual proof, unless it was a plain `works` | `ecrRef`, `status`, `reason`, `trigger`, every `answers` line |

In the POS this came from, these rows are queued to a sync table and read by
support without asking a store to find a log file. A script can
`console.log` them.

## Wiring it into a POS

The result shape is deliberately processor-neutral. Mapping it onto an
interface shared with a cloud processor is a few lines:

```ts
const processor: PaymentProcessor = {
  kind: 'pax',
  supportsStandaloneRefund: true,
  chargeTerminal: ({ total, retry_of }) => terminal.sale({ cents: total, retryOf: retry_of }),
  refundTerminal: ({ total }) => terminal.standaloneCredit({ cents: total }),
  refundTransfer: async (ref, cents) => {
    const r = await terminal.refund(ref, cents)
    if (!r.success) throw new Error(r.message)
  },
  voidAuthorization: async (ref) => {
    const r = await terminal.voidSale(ref)
    if (!r.success) throw new Error(r.message)
  }
}
```

Terminal settings a register needs: IP, port (10009), a display name. Set the
terminal to **ECR → Ethernet → TCP/IP**. Store the config per register; it is
not a secret.

## Protocol reference

`protocol` is exported as a namespace for anyone who needs the layer below:
`frame` / `unframe` / `hasCompleteFrame` / `lrc`, the request builders
(`buildSaleRequest`, `buildReturnRequest`, `buildVoidRequest`,
`buildLocalDetailReportRequest`, `buildRecordReportRequest`), the parsers
(`parseResponse`, `describeResponse`, `readDetailReport`,
`parseLocalDetailReport`, `describeDetailReport`) and the constants.

Framing: `STX + payload + ETX + LRC`, LRC = XOR over `payload + ETX`. Fields
`FS` (0x1C) delimited, groups `US` (0x1F) delimited.

`T00` request: `T00 | 1.58 | TransType | AmountInfo | Account | Trace | 5 empty groups`.
`T01` response: `0 | T01 | 1.58 | ResponseCode | Message | HostInfo | TransType | AmountInfo | Account | Trace | … | AdditionalInfo`.
Approval is `000000`. Seen on live terminals: `000100` host decline (message in
HostInfo: `PIN XLATE ER-181`, `AuthenticationError`, `FORMAT ERROR`,
`Failed_Ticket Status is not good`), `000002` partial, `100001 TIMEOUT` (no card
within the terminal's 30 s window), `100002 ABORTED` (cancelled on the pad),
`100003` format error, `100023 NOT FOUND` (report).

## Not here

- **Initialize (`A00`)** — asking the terminal its serial, model and app
  version. Designed, not yet sent to a live terminal.
- **Batch close.** RapidConnect terminals auto-settle.
- **PIN debit provisioning.** If every PIN debit fails host-side (`PIN XLATE`,
  `AuthenticationError`) regardless of the PIN, the terminal's DUKPT PIN key is
  not registered for the TID. That is a key injection / sponsorship task on the
  processor side; the request format is the same one that approves for credit.
- **Other POSLink host applications.** Framing and layout are POSLink; the
  `TransType` codes (`01`/`02`/`11`) and response codes are RapidConnect's. If
  your terminal runs a different application, start from `protocol.TransType`.

## Tests

```bash
npm test -- packages/pax-terminal
```

105 tests. The protocol suite parses a frame captured from a live terminal; the
terminal suite runs the whole flow — lock, ACK flush, recovery, retry, lookup
check — against a scripted fake `net.Socket`, one scripted behaviour per
connection.

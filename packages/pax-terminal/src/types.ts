/**
 * Connection to a PAX semi-integrated terminal on the local network. The
 * merchant's processor credentials live on the terminal itself, so nothing
 * sensitive is held here: an address, a port and an optional timeout.
 */
export type PaxTerminalConfig = {
  /** Terminal IP address (or hostname) on the local network. */
  host: string
  /** POSLink TCP port. Default 10009. */
  port?: number
  /**
   * Post-connect socket timeout in ms — how long a sale may sit on the terminal
   * while the customer inserts/taps and the host answers. Default 75 s; never
   * applied below 60 s (see `transactionTimeoutMs`).
   */
  timeout_ms?: number
}

/** `PaxTerminalConfig` with the defaults filled in. */
export type ResolvedTerminalConfig = { host: string; port: number; timeout_ms?: number }

export const DEFAULT_PORT = 10009

export function resolveConfig(config: PaxTerminalConfig): ResolvedTerminalConfig {
  return { host: config.host, port: config.port ?? DEFAULT_PORT, timeout_ms: config.timeout_ms }
}

/** A sale or standalone credit on the terminal. Amounts are integer cents. */
export type TerminalSaleInput = {
  /** Total in cents (2259 = $22.59). */
  cents: number
  /**
   * The ECR reference of this payment's earlier sale whose outcome is unknown
   * (the terminal accepted it and never answered — `PaxNoAnswerError.ecrRef`).
   * The terminal is asked about that sale first, and charged again only if it
   * holds no approval for it.
   */
  retryOf?: string
}

/**
 * What a terminal answered to a sale, return or void — processor-neutral, so a
 * POS can store it the same way whichever device took the card.
 */
export type PaxChargeResult = {
  /**
   * Durable reference for a later void or refund: the host's GLOBALUID, present
   * on approvals and declines alike; falls back to the host reference, then the
   * ECR trace reference.
   */
  reference: string
  /** True when money moved — a full approval or a partial one. */
  success: boolean
  status: 'approved' | 'declined'
  /** Cashier-facing text: the terminal's message, or what a partial took and left owing. */
  message: string
  /** Last four of the masked account the terminal returns; never a full PAN. */
  lastFour: string
  /** Visa / Mastercard / Amex / Discover / unknown, from the BIN or the EMV app label. */
  cardBrand: string
  /**
   * How the card was actually processed: a PIN was entered → 'debit', signature
   * or no CVM → 'credit'. The truth of what happened, regardless of which tender
   * key the cashier pressed.
   */
  tenderType: 'credit' | 'debit'
  /**
   * Cents the host captured. On a partial approval this is LESS than what was
   * asked — record this, not the request.
   */
  approvedCents: number
  /** The host approved less than requested; `amountDueCents` is still owed. */
  partial?: boolean
  amountDueCents?: number
  responseCode: string
  hostCode: string
  authCode: string
}

/** Result of a reachability probe. */
export type PaxProbeResult = {
  ok: boolean
  message: string
  /**
   * True when no connection was attempted (or it was abandoned) because the
   * terminal is running a command. The terminal was not measured — keep
   * reporting the last known status rather than record a sample.
   */
  skipped?: boolean
}

/**
 * Outcome of looking a known approved sale up on the terminal — the same
 * lookup that recovers a sale the terminal never answered. `works` means the
 * terminal returned that sale and it matched what was recorded.
 */
export type PaxLookupCheckStatus =
  | 'works'
  /** Found by reading the newest record, not by our reference. */
  | 'works-recent'
  | 'mismatch'
  | 'not-found'
  | 'no-answer'
  | 'busy'
  | 'no-sale'

export type PaxLookupCheckResult = {
  status: PaxLookupCheckStatus
  /** One sentence for the person reading it. */
  message: string
}

export type PaxLogger = {
  debug(message: string): void
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/** `operation` on every event: what was on the terminal. */
export type PaxOperation = 'sale' | 'credit' | 'refund' | 'void'

/**
 * Everything the terminal integration wants a host to know about, as one
 * structured event stream. A POS files these as support rows; a script can
 * `console.log` them. The reporter is a failure channel: a clean, full approval
 * emits nothing (the result already says so).
 */
export type PaxReportEvent = { terminal: string; requestedCents: number } & (
  | {
      /** The terminal answered, and the answer was not a clean full approval. */
      stage: 'response'
      operation: PaxOperation
      kind: 'decline' | 'partial'
      summary: PaxResponseSummary
    }
  | {
      /** Nothing came back to inspect: unreachable, timed out, closed early, corrupt frame. */
      stage: 'error'
      operation: PaxOperation
      kind: 'unreachable' | 'protocol'
      error: string
    }
  | {
      /** The charge approved but the finalize ACK could not be flushed — the terminal may stay armed. */
      stage: 'finalize'
      operation: PaxOperation
      error: string
    }
  | {
      /** A silent sale was looked up in the terminal's batch. */
      stage: 'recovery'
      ecrRef: string
      recovered: boolean
      trigger: 'no-answer' | 'retry'
      /** One line per report the terminal answered, as `describeDetailReport` puts it. */
      lookups: string[]
    }
  | {
      /** The daily / manual proof that the lookup works on this terminal. */
      stage: 'lookup-check'
      ecrRef: string
      status: PaxLookupCheckStatus
      reason: string
      trigger: 'daily' | 'manual'
      answers: string[]
    }
)

/**
 * Flat, loggable view of a T01 response — the fields worth reporting when a card
 * fails, extracted once so callers never re-parse the frame themselves.
 *
 * Carries no cardholder data beyond what the terminal already returns masked:
 * `lastFour` comes from the masked AccountInformation, and the frame never
 * contains a full PAN.
 */
export type PaxResponseSummary = {
  responseCode: string
  responseMessage: string
  hostCode: string
  hostMessage: string
  authCode: string
  /** null when the terminal returned a non-numeric or absent amount. */
  approveAmountCents: number | null
  amountDueCents: number | null
  lastFour: string
  cardBrand: string
  aid: string
  edcType: string
  tvr: string
  cvm: string
  globalUid: string
  /** The TraceInformation group joined with '/': what the terminal kept of our reference and when. */
  trace: string
}

export type PaxTiming = {
  /** TCP connect bound. A healthy terminal accepts in milliseconds. Default 5 s. */
  connectTimeoutMs?: number
  /** How many LocalDetailReport rounds a silent sale gets. Default 3. */
  recoveryAttempts?: number
  /** Socket timeout for each report request. Default 10 s. */
  recoveryTimeoutMs?: number
  /** Pause before each recovery round, so a terminal still storing the record can. Default 2 s. */
  recoveryGapMs?: number
  /** Delay after the day's first approval before the lookup check runs. Default 5 s. */
  lookupCheckDelayMs?: number
}

export type PaxTerminalOptions = {
  /** Where the integration's log lines go. Default: nowhere. */
  log?: Partial<PaxLogger>
  /** Receives every `PaxReportEvent`. Exceptions it throws are swallowed — it sits on the payment path. */
  report?: (event: PaxReportEvent) => void
  /** Counter hook: `metric('pax_lookup_check', 'works')`. */
  metric?: (name: string, label: string) => void
  /**
   * Whether a GLOBALUID already belongs to a sale the host has recorded — e.g. a
   * query on the transactions table. Used to refuse a batch record as a
   * recovered sale when it is one the register already took. Default: unknown.
   */
  isKnownReference?: (reference: string) => boolean
  /**
   * Letters in front of the six-digit ECR reference sent with every request
   * (`ECR000123`). A prefix plus six digits of up to eleven characters is what has
   * been proven on RapidConnect terminals. Default 'ECR'.
   */
  ecrPrefix?: string
  timing?: PaxTiming
}

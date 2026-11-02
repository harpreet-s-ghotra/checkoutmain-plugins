// Receipts: a PDF the width of the roll, sent the way the printer needs it.
export { printReceiptPdf, pageWidthPoints, dotsPerPoint, STAR_CUT_LP_OPTIONS } from './receipt'
export type { ReceiptJobOptions } from './receipt'
export {
  pdfToEscPosRaster,
  bitsToEscPos,
  rgbaToBits,
  trimTrailingBlankRows,
  densityCommand,
  isEpsonReceiptPrinter,
  printWidthDots,
  PRINT_WIDTH_DOTS,
  DARKNESS_LEVELS
} from './escpos-raster'
export { isEpsonReceiptQueue, resetEpsonCache } from './epson'
export type { DescribePrinter } from './epson'

// Transport: driver or raw, on every OS.
export { printPdfFile, printRawFile, printRawBytes } from './transport'
export type { PrintPdfOptions, RawPrintOptions } from './transport'
export {
  createRawPrinterHost,
  rawPrinterHostScript,
  RAW_HOST_READY,
  RAW_HOST_DONE
} from './windows-raw-host'
export type { RawPrinterHost, RawPrinterHostOptions } from './windows-raw-host'

// The drawer hangs off the receipt printer.
export { drawerKickBytes, openCashDrawer } from './cash-drawer'

// Shelf labels: ZPL for a Zebra, a PDF for the rest.
export { createLabelPrinter, renderLabelsPdf, micronsToPoints } from './label-printer'
export type {
  LabelPrinter,
  LabelPrinterDeps,
  LabelRenderOptions,
  BarcodeRenderer
} from './label-printer'
export { renderLabelZpl, renderLabelsZpl, micronsToDots } from './label-zpl'
export {
  hasValidGtinCheckDigit,
  selectSymbology,
  labelPrice,
  canPrintLabel,
  resolveLabelName,
  isPrintableLabelName,
  appendSize,
  clamp,
  sanitizeLabelSettings,
  isZebraPrinter,
  resolvePrintLanguage,
  computeLabelGrid,
  LABEL_SETTINGS_DEFAULTS,
  LABEL_SETTINGS_BOUNDS
} from './labels'
export type {
  LabelSymbology,
  LabelCandidate,
  PrintLanguage,
  LabelRect,
  LabelGrid,
  LabelMargins
} from './labels'
export { formatCurrency } from './format-currency'

export { DEFAULT_PRINT_DARKNESS } from './types'
export type {
  PaperWidthMm,
  PrintDarkness,
  ReceiptPrinter,
  ReceiptPrintPath,
  PrinterLogger,
  LabelSettings,
  LabelPrintItem,
  PrintLabelsInput,
  PrintLabelsResult
} from './types'

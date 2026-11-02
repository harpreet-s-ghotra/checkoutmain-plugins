/**
 * Dollar formatting for labels: thousands separators, two decimals, the sign
 * before the dollar sign (1234.5 → "$1,234.50"). Pass your own `formatPrice`
 * to the label printer for another currency.
 */
export const formatCurrency = (value: number, decimals = 2): string => {
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  return `${sign}$${abs.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })}`
}

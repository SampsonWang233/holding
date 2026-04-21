export interface Holding {
  id: string
  symbol: string
  /** Number of shares/units */
  shares: number
  /** Average cost per share */
  averageCost: number
}

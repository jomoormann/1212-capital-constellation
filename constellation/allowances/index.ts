// Each owner can swap up to 100,000 USDC a week, in either direction.
//
// USDC is one side of every swap, so one USDC limit covers both directions:
// - USDC to ETH: the USDC sold counts.
// - ETH to USDC: the USDC amount in the order (the minimum received) counts.
// The Roles mod counts token amounts and does not know the ETH price, so ETH
// sales also count against an ETH limit worth 100,000 USD at the price below.
// To update it, change ETH_USD and push again (a changed limit starts full).
//
// Limits refill to the full amount every 7 days, counted from the block the
// constellation is deployed in, and start full.
const ETH_USD = 2_276n; // Chainlink ETH/USD, 2026-11-03, block 26,334,470

const WEEK = 7n * 24n * 60n * 60n;
const USD_WEEKLY = 100_000n * 10n ** 6n; // 100,000 USDC
const ETH_WEEKLY = (100_000n * 10n ** 18n) / ETH_USD; // ≈ 43.94 ETH

const weekly = (key: string, amount: bigint, decimals: number) => ({
  key,
  refill: amount,
  maxRefill: amount,
  period: WEEK,
  balance: amount,
  timestamp: 0n,
  decimals,
});

/** The two weekly budgets of one owner's swap role */
export const budgetsFor = (owner: string) => ({
  usd: weekly(`usd_weekly_${owner}`, USD_WEEKLY, 6),
  eth: weekly(`eth_weekly_${owner}`, ETH_WEEKLY, 18),
});

export type Budgets = ReturnType<typeof budgetsFor>;

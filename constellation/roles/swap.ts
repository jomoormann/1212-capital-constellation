import { swap } from "@zodiaceco/sdk/actions";
import { zeroAddress } from "viem";
import config from "../../zodiac.config";
import type { Budgets } from "../allowances";

const { usdc, weth } = config.contracts.eth;

// The zero address names native ETH. Selling it wraps it first, since CoW only
// sells ERC20s; buying it pays out ETH.
const ETH = zeroAddress;

// CoW Swap between USDC and ETH (or WETH), and nothing else. Zodiac compiles
// each `swap` into CowswapOrderSigner orders whose receiver is the vault.
export const swapRole = (owner: `0x${string}`, budgets: Budgets) => ({
  policy: `USDC and ETH swaps (${owner.slice(0, 6)})`,
  description:
    "Swap USDC and ETH on CoW Swap, up to 100,000 USD a week. The vault receives the tokens.",
  members: [owner],
  permissions: [
    swap({
      label: "Sell USDC for ETH",
      sell: [usdc],
      buy: [ETH, weth],
      sellAllowance: budgets.usd,
    }),
    swap({
      label: "Sell ETH for USDC",
      sell: [ETH, weth],
      buy: [usdc],
      sellAllowance: budgets.eth,
      buyAllowance: budgets.usd,
    }),
  ] satisfies Permissions,
});

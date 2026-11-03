# 1212 Capital constellation

Adds a Roles mod to 1212 Capital's vault on Ethereum,
`0xf5b00fe2456168a0afa5abb86fc6684c1c13086b` (Safe 1.4.1, 2 of 3 owners). Each
of the three owners gets a role of their own to swap USDC and ETH on CoW Swap.

## What each role can do

| | |
|---|---|
| Members | One vault owner, from their own wallet: `swap_31d2` (0x31D2…A13c), `swap_362b` (0x362B…093a), `swap_8e27` (0x8e27…18af) |
| Swaps | USDC to ETH or WETH, and ETH or WETH to USDC, on CoW Swap. No other tokens. |
| Receiver | The vault only |
| Budget | 100,000 USD per week, per owner, shared by both directions |
| ETH cap | 43.94 ETH per week, per owner (100,000 USD at 2,276 USD/ETH) |
| Also | Approve USDC and WETH for the CoW vault relayer; wrap and unwrap ETH |

The vault owners keep full control of the vault and own the Roles mod.

## How the budget works

Roles meters raw token amounts and cannot price ETH. USDC is one side of every
swap, so the USD budget is kept in USDC:

- Selling USDC draws the USDC sold.
- Selling ETH draws the minimum USDC the order must return, and the ETH sold
  draws on the ETH cap.

Budgets refill to the full amount every 7 days, counted from the deploy block.
An order draws on the budget when it is signed, so a cancelled or expired order
still counts until the next refill.

**Known gap:** an ETH sale with a near-zero USDC minimum draws almost nothing
from the USD budget. The ETH cap still holds, so one owner can swap at most
100,000 USDC plus 43.94 ETH in a week.

To re-price the ETH cap, edit `ETH_USD` in `constellation/allowances/index.ts`
and push again. A changed budget starts full again.

## Commands

```bash
bun install
bun pull               # codegen for the workspace of the API key in .env
bun dry-run            # compile through Zodiac, stores nothing
bun test:permissions   # 37 checks on a mainnet fork (FORK_RPC)
bun push               # sends the constellation to Zodiac for review
```

`bun push` needs a Zodiac API key in `.env` as `ZODIAC_API_KEY`. The
constellation goes to the workspace named "1212 Capital" by default. To use
another workspace, set `ZODIAC_WORKSPACE` to its name.

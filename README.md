# 1212 Capital constellation

Adds a Roles mod to 1212 Capital's vault on Ethereum,
`0xf5b00fe2456168a0afa5abb86fc6684c1c13086b` (Safe 1.4.1, 2 of 3 owners). Each
of the three owners gets a role of their own to swap USDC and ETH on CoW Swap.

## What each role can do

|                  |                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Members          | One vault owner, from their own wallet: `swap_31d2` (0x31D2…A13c), `swap_362b` (0x362B…093a), `swap_8e27` (0x8e27…18af) |
| Swaps            | USDC to ETH or WETH, and ETH or WETH to USDC, on CoW Swap. No other tokens.                                             |
| Receiver         | The vault only                                                                                                          |
| Weekly limit     | 100,000 USDC per owner, for swaps in both directions                                                                    |
| Weekly ETH limit | 43.94 ETH per owner (100,000 USD at 2,276 USD per ETH)                                                                  |
| Also             | Approve USDC and WETH for the CoW vault relayer; wrap and unwrap ETH                                                    |

The vault owners keep full control of the vault and own the Roles mod.

## How the weekly limits work

Every swap counts against the owner's 100,000 USDC limit, in both directions:

- **USDC to ETH:** the USDC you sell counts.
- **ETH to USDC:** the USDC amount in the order counts. On CoW Swap, this is
  the minimum USDC you receive. The actual amount can be higher.

ETH to USDC swaps also count against the weekly ETH limit, with the ETH you
sell. The Roles mod counts token amounts and does not know the ETH price, so
ETH has a limit of its own.

**Example:** on Monday, an owner sells 60,000 USDC for ETH. Until the limit
refills, that owner can swap up to 40,000 USDC more, in either direction.

Both limits refill to the full amount every 7 days, counted from the block the
constellation is deployed in. An order counts when it is signed, so a
cancelled or expired order still counts until the next refill.

To update the ETH limit to a new ETH price, change `ETH_USD` in
`constellation/allowances/index.ts` and push again. A changed limit starts
full again.

## Commands

```bash
bun install
bun pull               # codegen for the workspace of the API key in .env
bun dry-run            # compile through Zodiac, stores nothing
bun test:permissions   # 36 checks on a mainnet fork (FORK_RPC)
bun push               # sends the constellation to Zodiac for review
```

`bun push` needs a Zodiac API key in `.env` as `ZODIAC_API_KEY`. The
constellation goes to the workspace named "1212 Capital" by default. To use
another workspace, set `ZODIAC_WORKSPACE` to its name.

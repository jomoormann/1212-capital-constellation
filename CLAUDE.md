# Zodiac Constellation: agent notes

This repo is a **Zodiac constellation**: a TypeScript description of an org's smart-account graph (Safes, mods, users, permissions). `bun push` sends the spec to Zodiac, which diffs it against onchain state and gives a UI to review + sign the transactions.

User-facing docs are in `README.md`. Read it before you change `constellation/`.

## This repo

1212 Capital's existing vault `0xf5b0…086b` on Ethereum (2/3 Safe 1.4.1, no
modules on 2026-11-03) is bound by address and gets a new Roles mod
"1212 Capital Roles" (nonce 0, owner/avatar/target = vault). Three roles, one
per vault owner wallet (EOA members): CoW swaps USDC <-> ETH/WETH, receiver =
vault, weekly budgets per owner `usd_weekly_<id>` (100,000 USDC, shared by both
directions: USDC sold, or minimum USDC bought) and `eth_weekly_<id>`
(100,000 USD of ETH at `ETH_USD`).

- The workspace is the one of the API key in `.env`. Set `ZODIAC_WORKSPACE`
  to compile against another workspace.
- `test/permissions-test.ts` (`bun test:permissions`, mainnet fork on FORK_RPC,
  e.g. `hardhat node --fork https://rpc.zodiacos.io/1`) deploys Roles
  mastercopy 0xf2964ce6…83d5 on the fork, enables it on the real vault
  (impersonated), loads the resolve output, acts as the real owners. 36/36 on
  2026-11-03. Run it after any change.
- Zodiac merges `roles` and `allowances` by name: remove one with `null`.

## Project map

- `constellation/index.ts`: entrypoint. **Only exported values get pushed.**
- `constellation/roles/swap.ts`: the role factory; `roles/index.ts` makes one role per owner.
- `constellation/allowances/index.ts`: weekly budgets and the ETH price.
- `scripts/dry-run.ts`: compiles through Zodiac's resolve (stores nothing).
- `.zodiac/`: generated codegen; never edit by hand. Re-run `bun pull`.

## Conventions

- `constellation`, `allow`, `c`, `ref` are **globals** (set up in `.lib/globals.ts`). Don't import them.
- Use Bun: `bun install`, `bun run <script>`, `bun <file.ts>`. Bun auto-loads `.env`.

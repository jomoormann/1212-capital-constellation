import { eth } from "./context";
import { VAULT } from "./members";
import { budgets, swap_31d2, swap_362b, swap_8e27 } from "./roles";

// 1212 Capital's existing vault gets a Roles mod. Each of its three owners
// holds a role that swaps USDC and ETH on CoW Swap, up to 100,000 USD a week,
// with the vault as the only receiver. The owners keep full control of the
// vault and of the Roles mod (2 of 3 signatures).

export const vault = eth.safe["1212 Capital Vault"]({
  address: VAULT,
  modules: [eth.roles["1212 Capital Roles"]],
  vault: true,
});

export const vault_roles = eth.roles["1212 Capital Roles"]({
  nonce: 0n,
  owner: vault,
  avatar: vault,
  target: vault,
  roles: { swap_31d2, swap_362b, swap_8e27 },
  allowances: Object.fromEntries(
    Object.values(budgets).flatMap(({ usd, eth }) => [
      [usd.key, usd],
      [eth.key, eth],
    ]),
  ),
});

#!/usr/bin/env bun
/**
 * Permission test.
 *
 * Deploys the Roles Modifier (the mastercopy Zodiac deploys) on a local
 * mainnet fork, enables it on 1212 Capital's real vault, loads the roles as
 * Zodiac compiles them, and then acts as each vault owner. Every call a role
 * allows has to go through; every other call has to be refused by the Roles
 * Modifier itself.
 *
 *   npx hardhat node --fork https://rpc.zodiacos.io/1   (or: anvil --fork-url …)
 *   bun test:permissions                               (FORK_RPC, default http://127.0.0.1:8545)
 *
 * Permissions come from Zodiac's resolve endpoint (ZODIAC_API_KEY from .env),
 * which compiles the spec and stores nothing. Set ZODIAC_WORKSPACE when the
 * key belongs to another workspace than 1212 Capital's.
 */
import "../.lib/globals";
import {
  concat,
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeErrorResult,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  formatUnits,
  hashTypedData,
  http,
  keccak256,
  maxUint256,
  numberToHex,
  parseAbi,
  parseEther,
  parseUnits,
  size,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { mainnet } from "viem/chains";
import {
  encodeKey,
  flattenCondition,
  rolesAbi,
  Status,
  type Condition,
} from "zodiac-roles-sdk";
import {
  OWNER_31D2,
  OWNER_362B,
  OWNER_8E27,
  VAULT,
} from "../constellation/members";
import { resolve } from "../scripts/dry-run";

const { default: config } = await import("../zodiac.config");
const { usdc, weth } = config.contracts.eth as Record<string, Address>;

const RPC = process.env.FORK_RPC ?? "http://127.0.0.1:8545";

// ───────────────────────── contracts and constants ─────────────────────────

const MODULE_FACTORY = "0x000000000000aDdB49795b0f9bA5BC298cDda236";
const ROLES_MASTERCOPY = "0xf2964ce6161ce0e75964fe7927ce114cb0b283d5"; // what Zodiac deploys
const MULTISEND = "0x38869bf66a61cf6bdb996a6ae40d5853fd43b526";
const MULTISEND_CALL_ONLY = "0x9641d764fc13c8b624c04430c7356c1c7c8102e2";
const MULTISEND_UNWRAPPER = "0x93b7fcbc63ed8a3a24b59e1c3e6649d50b7427c0";
const ORDER_SIGNER = "0x23dA9AdE38E4477b23770DeD512fD37b12381FAB";
const VAULT_RELAYER = "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110";
const SETTLEMENT = "0x9008D19f58AAbD9eD0D60971565AA8510560ab41";
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const DAI = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const NATIVE_ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const OUTSIDER = "0x00000000000000000000000000000000000bad00";

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function approve(address,uint256) returns (bool)",
]);
const wethAbi = parseAbi([
  "function deposit() payable",
  "function withdraw(uint256)",
]);
const safeAbi = parseAbi([
  "function enableModule(address)",
  "function isModuleEnabled(address) view returns (bool)",
]);
const moduleFactoryAbi = parseAbi([
  "function deployModule(address,bytes,uint256) returns (address)",
]);
const setUpAbi = parseAbi(["function setUp(bytes)"]);
const orderTuple =
  "(address sellToken,address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,bytes32 kind,bool partiallyFillable,bytes32 sellTokenBalance,bytes32 buyTokenBalance)";
const orderSignerAbi = parseAbi([
  `function signOrder(${orderTuple} order,uint32 validDuration,uint256 feeAmountBP)`,
  `function unsignOrder(${orderTuple} order)`,
]);
const settlementAbi = parseAbi([
  "function setPreSignature(bytes,bool)",
  "function preSignature(bytes) view returns (uint256)",
]);
const multisendAbi = parseAbi(["function multiSend(bytes)"]);

// ───────────────────────────── clients ─────────────────────────────

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(RPC),
});
const wallet = createWalletClient({ chain: mainnet, transport: http(RPC) });
const testClient = createTestClient({
  chain: mainnet,
  mode: "hardhat",
  transport: http(RPC),
});

const impersonate = async (address: Address) => {
  await testClient.impersonateAccount({ address });
  await testClient.setBalance({ address, value: parseEther("10") });
};

const send = async (from: Address, to: Address, data: Hex, value = 0n) => {
  const hash = await wallet.sendTransaction({
    account: from,
    to,
    data,
    value,
    chain: mainnet,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`tx to ${to} reverted`);
  return receipt;
};

const balance = (token: Address, owner: Address) =>
  publicClient.readContract({
    address: token,
    abi: erc20,
    functionName: "balanceOf",
    args: [owner],
  });

// ─────────────────── 1. compile the spec through Zodiac ───────────────────

console.log(
  "Compiling the constellation through Zodiac (resolve stores nothing)…",
);
const { result: resolved } = await resolve();
const compiled = resolved.find((n) => n.type === "ROLES");
if (!compiled) throw new Error("no Roles mod in the resolve result");

// ─────────────────────── 2. deploy on the fork ───────────────────────

const [deployer] = await wallet.getAddresses(); // an unlocked test account
console.log(
  `Deploying on the fork (${RPC}), block ${await publicClient.getBlockNumber()}…`,
);

// The Roles mod is owned by the vault, as in the constellation. On the fork
// the vault is impersonated to enable it and load the roles.
const deployReceipt = await send(
  deployer,
  MODULE_FACTORY,
  encodeFunctionData({
    abi: moduleFactoryAbi,
    functionName: "deployModule",
    args: [
      ROLES_MASTERCOPY,
      encodeFunctionData({
        abi: setUpAbi,
        functionName: "setUp",
        args: [
          encodeAbiParameters(
            [{ type: "address" }, { type: "address" }, { type: "address" }],
            [VAULT, VAULT, VAULT],
          ),
        ],
      }),
      BigInt(Date.now()),
    ],
  }),
);
const creation = deployReceipt.logs.find(
  (l) => l.address.toLowerCase() === MODULE_FACTORY.toLowerCase(),
)!;
const roles = `0x${creation.topics[1]!.slice(26)}` as Address;

await impersonate(VAULT);
const asVault = (to: Address, data: Hex) => send(VAULT, to, data);
await asVault(
  VAULT,
  encodeFunctionData({
    abi: safeAbi,
    functionName: "enableModule",
    args: [roles],
  }),
);

// ──────────────────── 3. load the compiled roles ────────────────────

const asRolesOwner = (functionName: string, args: readonly unknown[]) =>
  asVault(
    roles,
    encodeFunctionData({
      abi: rolesAbi,
      functionName: functionName as any,
      args: args as any,
    }),
  );

for (const role of compiled.roles) {
  for (const member of role.members)
    await asRolesOwner("assignRoles", [member, [role.key], [true]]);
  for (const target of role.targets) {
    if (target.clearance === 1) {
      await asRolesOwner("allowTarget", [
        role.key,
        target.address,
        target.executionOptions,
      ]);
      continue;
    }
    await asRolesOwner("scopeTarget", [role.key, target.address]);
    for (const fn of target.functions ?? []) {
      if (fn.wildcarded || fn.condition == null) {
        await asRolesOwner("allowFunction", [
          role.key,
          target.address,
          fn.selector,
          fn.executionOptions,
        ]);
        continue;
      }
      const flat = flattenCondition(fn.condition as Condition).map((c) => ({
        parent: c.parent,
        paramType: c.paramType,
        operator: c.operator,
        compValue: c.compValue ?? "0x",
      }));
      await asRolesOwner("scopeFunction", [
        role.key,
        target.address,
        fn.selector,
        flat,
        fn.executionOptions,
      ]);
    }
  }
}
for (const a of compiled.allowances) {
  await asRolesOwner("setAllowance", [
    a.key,
    BigInt(a.balance),
    BigInt(a.maxRefill),
    BigInt(a.refill),
    BigInt(a.period),
    BigInt(a.timestamp),
  ]);
}
for (const multisend of compiled.multisend ?? [
  MULTISEND,
  MULTISEND_CALL_ONLY,
]) {
  await asRolesOwner("setTransactionUnwrapper", [
    multisend,
    "0x8d80ff0a",
    MULTISEND_UNWRAPPER,
  ]);
}

// ─────────────────────── 4. fund the vault ───────────────────────

await testClient.setBalance({ address: VAULT, value: parseEther("100") });
const WHALES = [
  "0x37305B1cD40574E4C5Ce33f8e8306Be057fD7341", // Sky PSM
  "0x28C6c06298d514Db089934071355E5743bf21d60", // Binance
  "0xF977814e90dA44bFA03b6295A0616a897441aceC", // Binance
  "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb", // Morpho Blue
] as Address[];
const fund = async (token: Address, amount: bigint) => {
  for (const whale of WHALES) {
    if ((await balance(token, whale)) < amount) continue;
    await impersonate(whale);
    await send(
      whale,
      token,
      encodeFunctionData({
        abi: erc20,
        functionName: "transfer",
        args: [VAULT, amount],
      }),
    );
    return;
  }
  throw new Error(`no whale with enough ${token}`);
};
await fund(usdc, parseUnits("400000", 6));

for (const who of [OWNER_31D2, OWNER_362B, OWNER_8E27, OUTSIDER] as Address[])
  await impersonate(who);

// ───────────────────────────── 5. helpers ─────────────────────────────

type Call = { to: Address; data: Hex; value?: bigint; operation?: 0 | 1 };
// A refusal only counts when the Roles Modifier itself refused (byRoles)
type Outcome =
  { ok: true; note?: string } | { ok: false; reason: string; byRoles: boolean };

const execAs = async (
  member: Address,
  role: string,
  call: Call,
): Promise<Outcome> => {
  const data = encodeFunctionData({
    abi: rolesAbi,
    functionName: "execTransactionWithRole",
    args: [
      call.to,
      call.value ?? 0n,
      call.data,
      call.operation ?? 0,
      encodeKey(role),
      true,
    ],
  });
  // Plain eth_call, so the revert data comes back the same from anvil and
  // hardhat (hardhat nests it one level deeper)
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ from: member, to: roles, data }, "latest"],
    }),
  });
  const { error } = (await response.json()) as {
    error?: { message: string; data?: any };
  };
  if (error) {
    const revert = (
      typeof error.data === "string" ? error.data : error.data?.data
    ) as Hex | undefined;
    let decoded;
    try {
      decoded = decodeErrorResult({ abi: rolesAbi, data: revert! });
    } catch {
      return {
        ok: false,
        byRoles: false,
        reason: `not a Roles error: ${error.message}`,
      };
    }
    if (decoded.errorName === "ModuleTransactionFailed")
      return {
        ok: false,
        byRoles: false,
        reason: "Roles allowed it; the call itself reverted",
      };
    if (decoded.errorName === "ConditionViolation")
      return {
        ok: false,
        byRoles: true,
        reason: Status[Number(decoded.args[0])] ?? `status ${decoded.args[0]}`,
      };
    return { ok: false, byRoles: true, reason: decoded.errorName };
  }
  await send(member, roles, data);
  return { ok: true };
};

let failures = 0;
let passes = 0;
const expect = async (
  want: "allow" | "deny",
  who: string,
  what: string,
  outcome: Promise<Outcome>,
  verify?: () => Promise<boolean>,
) => {
  const o = await outcome;
  let pass = want === "allow" ? o.ok : !o.ok && o.byRoles;
  let detail = o.ok ? (o.note ?? "executed") : o.reason;
  if (pass && o.ok && verify && !(await verify())) {
    pass = false;
    detail += ", but the effect is missing";
  }
  pass ? passes++ : failures++;
  console.log(
    `${pass ? "✓" : "✗"} ${want === "allow" ? "allowed" : "refused"}  ${who.padEnd(5)} ${what}  [${detail}]`,
  );
};
const section = (title: string) => console.log(`\n── ${title}`);

const call = (
  to: Address,
  abi: any,
  functionName: string,
  args: readonly unknown[] = [],
  extra: Partial<Call> = {},
): Call => ({
  to,
  data: encodeFunctionData({ abi, functionName, args } as any),
  ...extra,
});
const now = async () => (await publicClient.getBlock()).timestamp;

const budget = async (key: string) => {
  const [, , , left] = (await publicClient.readContract({
    address: roles,
    abi: rolesAbi,
    functionName: "allowances",
    args: [encodeKey(key)],
  })) as readonly bigint[];
  return left!;
};
const budgetIs = (key: string, want: bigint) => async () => {
  const left = await budget(key);
  if (left !== want) console.log(`    ${key}: ${left} left, expected ${want}`);
  return left === want;
};

// CoW orders. Defaults: a sell order to the vault, no fee, ERC20 balances.
const ERC20_BALANCE = keccak256(toBytes("erc20"));
const KIND = {
  sell: keccak256(toBytes("sell")),
  buy: keccak256(toBytes("buy")),
};
const settlementDomain = {
  name: "Gnosis Protocol",
  version: "v2",
  chainId: 1,
  verifyingContract: SETTLEMENT,
} as const;
const orderTypes = {
  Order: [
    { name: "sellToken", type: "address" },
    { name: "buyToken", type: "address" },
    { name: "receiver", type: "address" },
    { name: "sellAmount", type: "uint256" },
    { name: "buyAmount", type: "uint256" },
    { name: "validTo", type: "uint32" },
    { name: "appData", type: "bytes32" },
    { name: "feeAmount", type: "uint256" },
    { name: "kind", type: "string" },
    { name: "partiallyFillable", type: "bool" },
    { name: "sellTokenBalance", type: "string" },
    { name: "buyTokenBalance", type: "string" },
  ],
} as const;
type Order = {
  sellToken: Address;
  buyToken: Address;
  receiver: Address;
  sellAmount: bigint;
  buyAmount: bigint;
  validTo: number;
  appData: Hex;
  feeAmount: bigint;
  kind: Hex;
  partiallyFillable: boolean;
  sellTokenBalance: Hex;
  buyTokenBalance: Hex;
};
const order = async (
  o: Partial<Order> & Pick<Order, "sellToken" | "buyToken" | "sellAmount">,
): Promise<Order> => ({
  receiver: VAULT,
  buyAmount: 1n,
  validTo: Number((await now()) + 3600n),
  appData: `0x${"00".repeat(32)}`,
  feeAmount: 0n,
  kind: KIND.sell,
  partiallyFillable: false,
  sellTokenBalance: ERC20_BALANCE,
  buyTokenBalance: ERC20_BALANCE,
  ...o,
});
const signOrder = (o: Order) =>
  call(ORDER_SIGNER, orderSignerAbi, "signOrder", [o, 7200, 0n], {
    operation: 1,
  });
const unsignOrder = (o: Order) =>
  call(ORDER_SIGNER, orderSignerAbi, "unsignOrder", [o], { operation: 1 });
const uidOf = (o: Order) => {
  const digest = hashTypedData({
    domain: settlementDomain,
    types: orderTypes,
    primaryType: "Order",
    message: {
      ...o,
      kind: o.kind === KIND.buy ? "buy" : "sell",
      sellTokenBalance: "erc20",
      buyTokenBalance: "erc20",
    },
  });
  return encodePacked(
    ["bytes32", "address", "uint32"],
    [digest, VAULT, o.validTo],
  );
};
const presigned = async (o: Order) =>
  (await publicClient.readContract({
    address: SETTLEMENT,
    abi: settlementAbi,
    functionName: "preSignature",
    args: [uidOf(o)],
  })) !== 0n;
const multiSend = (calls: Call[]): Call =>
  call(
    MULTISEND,
    multisendAbi,
    "multiSend",
    [
      concat(
        calls.map((c) =>
          encodePacked(
            ["uint8", "address", "uint256", "uint256", "bytes"],
            [
              c.operation ?? 0,
              c.to,
              c.value ?? 0n,
              BigInt(size(c.data)),
              c.data,
            ],
          ),
        ),
      ),
    ],
    { operation: 1 },
  );

const USD = (n: string) => parseUnits(n, 6);
const ETH = (n: string) => parseEther(n);
const USD_WEEKLY = USD("100000");
const ETH_WEEKLY = BigInt(
  compiled.allowances.find((a: any) => a.key === encodeKey("eth_weekly_31d2"))
    .maxRefill,
);
console.log(
  `Budgets per owner: ${formatUnits(USD_WEEKLY, 6)} USDC and ${formatUnits(ETH_WEEKLY, 18)} ETH a week`,
);

// ───────────────────────────── 6. the checks ─────────────────────────────

section("membership: each owner holds their own role, nobody else");
await expect(
  "deny",
  "out",
  "outside address uses swap_31d2",
  execAs(
    OUTSIDER,
    "swap_31d2",
    call(usdc, erc20, "approve", [VAULT_RELAYER, 1n]),
  ),
);
await expect(
  "deny",
  "31d2",
  "uses the role of owner 362b",
  execAs(
    OWNER_31D2,
    "swap_362b",
    call(usdc, erc20, "approve", [VAULT_RELAYER, 1n]),
  ),
);

section("owner 31d2: USDC to ETH, counted against the 100,000 USDC limit");
await expect(
  "allow",
  "31d2",
  "approve USDC for the CoW vault relayer",
  execAs(
    OWNER_31D2,
    "swap_31d2",
    call(usdc, erc20, "approve", [VAULT_RELAYER, maxUint256]),
  ),
);
const usdcForWeth = await order({
  sellToken: usdc,
  buyToken: weth,
  sellAmount: USD("60000"),
});
await expect(
  "allow",
  "31d2",
  "sell 60,000 USDC for WETH",
  execAs(OWNER_31D2, "swap_31d2", signOrder(usdcForWeth)),
  async () =>
    (await presigned(usdcForWeth)) &&
    (await budgetIs("usd_weekly_31d2", USD("40000"))()),
);
const usdcForEth = await order({
  sellToken: usdc,
  buyToken: NATIVE_ETH,
  sellAmount: USD("10000"),
});
await expect(
  "allow",
  "31d2",
  "sell 10,000 USDC for native ETH",
  execAs(OWNER_31D2, "swap_31d2", signOrder(usdcForEth)),
  budgetIs("usd_weekly_31d2", USD("30000")),
);
await expect(
  "allow",
  "31d2",
  "cancel that order (the budget stays spent)",
  execAs(OWNER_31D2, "swap_31d2", unsignOrder(usdcForEth)),
  async () =>
    !(await presigned(usdcForEth)) &&
    (await budgetIs("usd_weekly_31d2", USD("30000"))()),
);
await expect(
  "deny",
  "31d2",
  "sell 30,001 USDC (over the 30,000 left)",
  execAs(
    OWNER_31D2,
    "swap_31d2",
    signOrder(
      await order({
        sellToken: usdc,
        buyToken: weth,
        sellAmount: USD("30001"),
      }),
    ),
  ),
);

section(
  "owner 31d2: ETH to USDC, counted against the same USDC limit and the ETH limit",
);
await expect(
  "allow",
  "31d2",
  "wrap 20 ETH",
  execAs(
    OWNER_31D2,
    "swap_31d2",
    call(weth, wethAbi, "deposit", [], { value: ETH("20") }),
  ),
  async () => (await balance(weth, VAULT)) >= ETH("20"),
);
await expect(
  "allow",
  "31d2",
  "approve WETH for the CoW vault relayer",
  execAs(
    OWNER_31D2,
    "swap_31d2",
    call(weth, erc20, "approve", [VAULT_RELAYER, maxUint256]),
  ),
);
await expect(
  "allow",
  "31d2",
  "sell 5 WETH for at least 11,000 USDC",
  execAs(
    OWNER_31D2,
    "swap_31d2",
    signOrder(
      await order({
        sellToken: weth,
        buyToken: usdc,
        sellAmount: ETH("5"),
        buyAmount: USD("11000"),
      }),
    ),
  ),
  async () =>
    (await budgetIs("usd_weekly_31d2", USD("19000"))()) &&
    (await budgetIs("eth_weekly_31d2", ETH_WEEKLY - ETH("5"))()),
);
await expect(
  "allow",
  "31d2",
  "buy exactly 10,000 USDC for at most 4.5 WETH (buy order)",
  execAs(
    OWNER_31D2,
    "swap_31d2",
    signOrder(
      await order({
        sellToken: weth,
        buyToken: usdc,
        sellAmount: ETH("4.5"),
        buyAmount: USD("10000"),
        kind: KIND.buy,
      }),
    ),
  ),
  budgetIs("usd_weekly_31d2", USD("9000")),
);
await expect(
  "deny",
  "31d2",
  "sell 4 WETH for at least 9,001 USDC (over the 9,000 USD left)",
  execAs(
    OWNER_31D2,
    "swap_31d2",
    signOrder(
      await order({
        sellToken: weth,
        buyToken: usdc,
        sellAmount: ETH("4"),
        buyAmount: USD("9001"),
      }),
    ),
  ),
);
await expect(
  "deny",
  "31d2",
  "sell 35 WETH (over the ETH limit left)",
  execAs(
    OWNER_31D2,
    "swap_31d2",
    signOrder(
      await order({ sellToken: weth, buyToken: usdc, sellAmount: ETH("35") }),
    ),
  ),
);
await expect(
  "allow",
  "31d2",
  "unwrap 1 WETH",
  execAs(OWNER_31D2, "swap_31d2", call(weth, wethAbi, "withdraw", [ETH("1")])),
);

section("owner 362b: own budget, and every order field the role pins");
await expect(
  "deny",
  "362b",
  "sell 100,001 USDC in one order",
  execAs(
    OWNER_362B,
    "swap_362b",
    signOrder(
      await order({
        sellToken: usdc,
        buyToken: weth,
        sellAmount: USD("100001"),
      }),
    ),
  ),
);
const pinned: [string, Promise<Order>][] = [
  [
    "receiver is an outside address (USDC to WETH)",
    order({
      sellToken: usdc,
      buyToken: weth,
      sellAmount: USD("1000"),
      receiver: OUTSIDER,
    }),
  ],
  [
    "receiver is an outside address (WETH to USDC)",
    order({
      sellToken: weth,
      buyToken: usdc,
      sellAmount: ETH("1"),
      receiver: OUTSIDER,
    }),
  ],
  [
    "sell USDC for USDT",
    order({ sellToken: usdc, buyToken: USDT, sellAmount: USD("1000") }),
  ],
  [
    "sell USDT for USDC",
    order({ sellToken: USDT, buyToken: usdc, sellAmount: USD("1000") }),
  ],
  [
    "sell WETH for DAI",
    order({ sellToken: weth, buyToken: DAI, sellAmount: ETH("1") }),
  ],
  [
    "sell DAI for WETH",
    order({ sellToken: DAI, buyToken: weth, sellAmount: ETH("1000") }),
  ],
  [
    "sell USDC for WETH with a signed fee",
    order({
      sellToken: usdc,
      buyToken: weth,
      sellAmount: USD("1000"),
      feeAmount: 1n,
    }),
  ],
  [
    "sell from the CoW internal balance",
    order({
      sellToken: usdc,
      buyToken: weth,
      sellAmount: USD("1000"),
      sellTokenBalance: keccak256(toBytes("internal")),
    }),
  ],
  [
    "pay out to the CoW internal balance",
    order({
      sellToken: usdc,
      buyToken: weth,
      sellAmount: USD("1000"),
      buyTokenBalance: keccak256(toBytes("internal")),
    }),
  ],
];
for (const [what, o] of pinned)
  await expect(
    "deny",
    "362b",
    what,
    execAs(OWNER_362B, "swap_362b", signOrder(await o)),
  );
await expect(
  "allow",
  "362b",
  "sell 100,000 USDC (own budget, untouched by 31d2)",
  execAs(
    OWNER_362B,
    "swap_362b",
    signOrder(
      await order({
        sellToken: usdc,
        buyToken: weth,
        sellAmount: USD("100000"),
      }),
    ),
  ),
  budgetIs("usd_weekly_362b", 0n),
);

section("everything else is refused");
const outside: [string, Call][] = [
  [
    "transfer USDC to an outside address",
    call(usdc, erc20, "transfer", [OUTSIDER, USD("1")]),
  ],
  [
    "approve USDC for an outside address",
    call(usdc, erc20, "approve", [OUTSIDER, USD("1")]),
  ],
  [
    "transfer WETH to an outside address",
    call(weth, erc20, "transfer", [OUTSIDER, 1n]),
  ],
  [
    "approve USDT for the CoW vault relayer",
    call(USDT, erc20, "approve", [VAULT_RELAYER, 1n]),
  ],
  [
    "send 1 ETH to an outside address",
    { to: OUTSIDER, data: "0x", value: ETH("1") },
  ],
  [
    "pre-sign on the CoW settlement directly",
    call(SETTLEMENT, settlementAbi, "setPreSignature", [
      numberToHex(1n, { size: 56 }),
      true,
    ]),
  ],
  [
    "enable a module on the vault",
    call(VAULT, safeAbi, "enableModule", [OUTSIDER]),
  ],
];
for (const [what, c] of outside)
  await expect("deny", "8e27", what, execAs(OWNER_8E27, "swap_8e27", c));

section("batches through MultiSend are checked call by call");
await expect(
  "allow",
  "8e27",
  "approve USDC + sell 1,000 USDC for WETH in one batch",
  execAs(
    OWNER_8E27,
    "swap_8e27",
    multiSend([
      call(usdc, erc20, "approve", [VAULT_RELAYER, maxUint256]),
      signOrder(
        await order({
          sellToken: usdc,
          buyToken: weth,
          sellAmount: USD("1000"),
        }),
      ),
    ]),
  ),
  budgetIs("usd_weekly_8e27", USD("99000")),
);
await expect(
  "deny",
  "8e27",
  "approve USDC + transfer USDC out in one batch",
  execAs(
    OWNER_8E27,
    "swap_8e27",
    multiSend([
      call(usdc, erc20, "approve", [VAULT_RELAYER, maxUint256]),
      call(usdc, erc20, "transfer", [OUTSIDER, USD("1")]),
    ]),
  ),
);

section("the budget refills after a week");
await expect(
  "deny",
  "362b",
  "sell 1 USDC with the week's budget spent",
  execAs(
    OWNER_362B,
    "swap_362b",
    signOrder(
      await order({ sellToken: usdc, buyToken: weth, sellAmount: USD("1") }),
    ),
  ),
);
await testClient.increaseTime({ seconds: 7 * 24 * 60 * 60 + 1 });
await testClient.mine({ blocks: 1 });
await expect(
  "allow",
  "362b",
  "sell 100,000 USDC a week later",
  execAs(
    OWNER_362B,
    "swap_362b",
    signOrder(
      await order({
        sellToken: usdc,
        buyToken: weth,
        sellAmount: USD("100000"),
      }),
    ),
  ),
  budgetIs("usd_weekly_362b", 0n),
);

console.log(
  `\n${passes}/${passes + failures} checks passed${failures ? `, ${failures} FAILED` : ""}`,
);
process.exit(failures ? 1 : 0);

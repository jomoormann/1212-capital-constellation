#!/usr/bin/env bun
// Compiles the constellation through Zodiac's resolve endpoint (stores
// nothing), prints the nodes with their addresses and the compiled roles.
// `--json <path>` also writes the resolve result to a file.
import "../.lib/globals";
import { push } from "@zodiaceco/sdk";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

export const resolve = async () => {
  const nodes = await import("../constellation");
  const API = (
    process.env.ZODIAC_API_URL ?? "https://app.zodiac.eco/api/v1"
  ).replace(/\/$/, "");

  let captured: { workspaceId: string; payload: any } | undefined;
  await push(nodes as any, {
    api: {
      applyConstellation: async (workspaceId: string, payload: any) => {
        captured = { workspaceId, payload };
        return {} as any;
      },
    } as any,
  });
  if (!captured) throw new Error("push() produced no payload");
  const spec = JSON.parse(
    JSON.stringify(captured.payload.specification, (_, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
  );

  const res = await fetch(
    `${API}/workspace/${captured.workspaceId}/constellation/resolve`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.ZODIAC_API_KEY}`,
      },
      body: JSON.stringify({ specification: spec }),
    },
  );
  if (!res.ok)
    throw new Error(`resolve failed: ${res.status} ${await res.text()}`);
  const { result } = (await res.json()) as { result: any[] };
  return { workspaceId: captured.workspaceId, spec, result };
};

if (import.meta.main) {
  const { workspaceId, result } = await resolve();
  const client = createPublicClient({
    chain: mainnet,
    transport: http(
      process.env.ETH_RPC ?? "https://ethereum-rpc.publicnode.com",
    ),
  });
  console.log(`workspace ${workspaceId}`);
  for (const node of result) {
    const code = await client.getCode({ address: node.address });
    const taken = code && code !== "0x";
    console.log(
      `${node.type.padEnd(6)} ${String(node.label).padEnd(22)} ${node.address} ${taken ? "on chain" : "empty"}`,
    );
  }
  const roles = result.find((n) => n.type === "ROLES");
  for (const role of roles?.roles ?? [])
    console.log(
      `role ${role.key} members ${role.members.join(", ")}, ${role.targets.length} targets`,
    );
  for (const a of roles?.allowances ?? [])
    console.log(
      `allowance ${a.key} refill ${a.refill} max ${a.maxRefill} period ${a.period}s balance ${a.balance}`,
    );
  const out = process.argv.indexOf("--json");
  if (out > 0)
    await Bun.write(process.argv[out + 1], JSON.stringify(result, null, 1));
}

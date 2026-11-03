import { defineConfig } from "@zodiaceco/sdk/cli/config";

// Tokens the swap roles trade, on Ethereum mainnet
export default defineConfig({
  contracts: {
    eth: {
      usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    },
  },
});

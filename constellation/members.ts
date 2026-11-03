// 1212 Capital's vault: a 2-of-3 Safe 1.4.1 on Ethereum, no modules enabled
// (read on chain 2026-11-03, block 26,334,470).
export const VAULT = "0xf5b00fe2456168a0afa5abb86fc6684c1c13086b" as const;

// The vault's three owners (getOwners). Each holds a swap role of their own
// and uses it from the same wallet they sign vault transactions with.
export const OWNER_31D2 = "0x31D2C0B97621657a9D033059149EA7c971D1A13c" as const;
export const OWNER_362B = "0x362B10ef510A4844feD5876beF7c4A978355093a" as const;
export const OWNER_8E27 = "0x8e278968F917Ce96d62F1E217F9DAbf20d3d18af" as const;

// Single constellation instance shared by index.ts and the role files.
//
// The workspace is the one the API key in .env belongs to (`bun pull-org`
// lists it). Set ZODIAC_WORKSPACE to compile against another workspace.
export const eth = constellation({
  workspace: (process.env.ZODIAC_WORKSPACE ?? "1212 Capital") as any,
  label: "1212 Capital",
  chain: 1, // ethereum
});

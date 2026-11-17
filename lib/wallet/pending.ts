import { isAddress, type Hash } from "viem";

export type SavedPendingApproval = {
  hash: Hash;
  account: `0x${string}`;
};

export function parsePendingApproval(value: string | null): SavedPendingApproval | null {
  if (value === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Saved transaction recovery data is invalid. Clear this tab's session storage before continuing.");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("hash" in parsed) ||
    !("account" in parsed) ||
    typeof parsed.hash !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(parsed.hash) ||
    typeof parsed.account !== "string" ||
    !isAddress(parsed.account, { strict: false })
  ) {
    throw new Error("Saved transaction recovery data is invalid. Clear this tab's session storage before continuing.");
  }

  return {
    hash: parsed.hash as Hash,
    account: parsed.account,
  };
}

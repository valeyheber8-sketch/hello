import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateApprovalAmount,
  extractWalletAddress,
  generateTrustWalletDeepLink,
  isSupportedMobileDevice,
} from "./config";
import { parsePendingApproval } from "./pending";

test("calculates exactly one token unit using token decimals", () => {
  assert.equal(calculateApprovalAmount(6), BigInt("1000000"));
  assert.equal(calculateApprovalAmount(18), BigInt("1000000000000000000"));
});

test("rejects invalid token decimal values", () => {
  assert.throws(() => calculateApprovalAmount(-1), /decimals/);
  assert.throws(() => calculateApprovalAmount(6.5), /decimals/);
});

test("preserves the complete WalletConnect URI in the Trust Wallet deep link", () => {
  const uri = "wc:topic@2?relay-protocol=irn&symKey=abc%2Fdef";
  const deepLink = generateTrustWalletDeepLink(uri);

  assert.equal(new URL(deepLink).searchParams.get("uri"), uri);
  assert.equal(deepLink, `trust://wc?uri=${encodeURIComponent(uri)}`);
});

test("rejects malformed WalletConnect URIs", () => {
  assert.throws(() => generateTrustWalletDeepLink("https://example.test"), /invalid/);
});

test("extracts only a valid BNB Chain account", () => {
  const address = "0x1111111111111111111111111111111111111111";
  assert.equal(extractWalletAddress([`eip155:56:${address}`]), address);
  assert.throws(() => extractWalletAddress([`eip155:1:${address}`]), /BNB Chain account/);
  assert.throws(() => extractWalletAddress(["eip155:56:not-an-address"]), /valid BNB Chain account/);
});

test("detects mobile user agents only", () => {
  assert.equal(isSupportedMobileDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)"), true);
  assert.equal(isSupportedMobileDevice("Mozilla/5.0 (X11; Linux x86_64)"), false);
});

test("validates persisted transaction recovery state", () => {
  const hash = `0x${"a".repeat(64)}`;
  const account = "0x1111111111111111111111111111111111111111";
  assert.deepEqual(
    parsePendingApproval(JSON.stringify({ hash, account })),
    { hash, account },
  );
  assert.throws(() => parsePendingApproval("{"), /recovery data is invalid/);
  assert.throws(
    () => parsePendingApproval(JSON.stringify({ hash: "0x1234", account })),
    /recovery data is invalid/,
  );
});

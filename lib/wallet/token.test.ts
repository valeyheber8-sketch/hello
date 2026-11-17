import assert from "node:assert/strict";
import test from "node:test";
import type { BlockchainConfig } from "./config";
import {
  encodeApprovalData,
  getTransactionHash,
  validateApprovalTransaction,
} from "./token";

const config: BlockchainConfig = {
  chainId: 56,
  rpcUrl: "https://rpc.example.test",
  tokenAddress: "0x1111111111111111111111111111111111111111",
  spenderAddress: "0x2222222222222222222222222222222222222222",
  projectId: "352a5e8a30bf591bc1cd953e30f9d3ef",
};
const account = "0x3333333333333333333333333333333333333333";
const oneUsdt = BigInt("1000000");

test("validates the encoded one-USDT approval for the configured spender", () => {
  const data = encodeApprovalData(config.spenderAddress, oneUsdt);
  assert.doesNotThrow(() =>
    validateApprovalTransaction(account, config, 56, oneUsdt, data, 6),
  );
});

test("rejects an incorrect chain, spender, or amount", () => {
  const correctData = encodeApprovalData(config.spenderAddress, oneUsdt);
  const wrongSpenderData = encodeApprovalData(
    "0x4444444444444444444444444444444444444444",
    oneUsdt,
  );

  assert.throws(
    () => validateApprovalTransaction(account, config, 1, oneUsdt, correctData, 6),
    /BNB Smart Chain/,
  );
  assert.throws(
    () => validateApprovalTransaction(account, config, 56, oneUsdt, wrongSpenderData, 6),
    /configured spender and amount/,
  );
  assert.throws(
    () =>
      validateApprovalTransaction(
        account,
        config,
        56,
        BigInt("1000001"),
        encodeApprovalData(config.spenderAddress, BigInt("1000001")),
        6,
      ),
    /configured spender and amount/,
  );
});

test("validates wallet-returned transaction hashes", () => {
  assert.equal(getTransactionHash(`0x${"a".repeat(64)}`), `0x${"a".repeat(64)}`);
  assert.throws(() => getTransactionHash("not-a-hash"), /invalid transaction hash/);
});

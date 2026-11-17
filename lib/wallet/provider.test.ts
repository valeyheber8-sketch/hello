import assert from "node:assert/strict";
import test from "node:test";
import type { BlockchainConfig } from "./config";
import { configureChains } from "./provider";

const config: BlockchainConfig = {
  chainId: 56,
  rpcUrl: "https://rpc.example.test",
  tokenAddress: "0x1111111111111111111111111111111111111111",
  spenderAddress: "0x2222222222222222222222222222222222222222",
  projectId: "352a5e8a30bf591bc1cd953e30f9d3ef",
};

test("requests only the BNB Chain transaction permission needed for approval", () => {
  assert.deepEqual(configureChains(config), {
    eip155: {
      chains: ["eip155:56"],
      methods: ["eth_sendTransaction"],
      events: ["accountsChanged", "chainChanged"],
      rpcMap: { "eip155:56": config.rpcUrl },
    },
  });
});

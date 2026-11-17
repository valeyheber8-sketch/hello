import {
  createPublicClient,
  decodeFunctionData,
  encodeFunctionData,
  formatUnits,
  http,
  isAddress,
  parseAbi,
  type Hash,
} from "viem";
import { bsc } from "viem/chains";
import type { BlockchainConfig } from "./config";
import { calculateApprovalAmount } from "./config";
import type { WalletConnection } from "./provider";
import { getCurrentChainId } from "./provider";

const erc20Abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export type ApprovalDetails = {
  tokenName: string;
  tokenSymbol: string;
  decimals: number;
  amount: bigint;
  balance: bigint;
  allowance: bigint;
  data: `0x${string}`;
};

function createReadClient(config: BlockchainConfig) {
  return createPublicClient({
    chain: bsc,
    transport: http(config.rpcUrl),
  });
}

type ReadClient = ReturnType<typeof createReadClient>;

export async function initializeTokenContract(
  config: BlockchainConfig,
): Promise<ReadClient> {
  const client = createReadClient(config);
  if ((await client.getChainId()) !== config.chainId) {
    throw new Error("The RPC endpoint is not connected to BNB Smart Chain.");
  }
  const [tokenCode, spenderCode] = await Promise.all([
    client.getCode({ address: config.tokenAddress }),
    client.getCode({ address: config.spenderAddress }),
  ]);
  if (!tokenCode || tokenCode === "0x") {
    throw new Error("The configured USDT token address has no contract code on BNB Smart Chain.");
  }
  if (!spenderCode || spenderCode === "0x") {
    throw new Error("The configured spender address has no contract code on BNB Smart Chain.");
  }
  return client;
}

export async function getTokenSymbol(
  client: ReadClient,
  tokenAddress: `0x${string}`,
): Promise<string> {
  return client.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "symbol",
  });
}

export async function getTokenName(
  client: ReadClient,
  tokenAddress: `0x${string}`,
): Promise<string> {
  return client.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "name",
  });
}

export async function getTokenDecimals(
  client: ReadClient,
  tokenAddress: `0x${string}`,
): Promise<number> {
  return client.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "decimals",
  });
}

export async function getTokenBalance(
  client: ReadClient,
  tokenAddress: `0x${string}`,
  account: `0x${string}`,
): Promise<bigint> {
  return client.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account],
  });
}

export async function getTokenAllowance(
  client: ReadClient,
  tokenAddress: `0x${string}`,
  account: `0x${string}`,
  spender: `0x${string}`,
): Promise<bigint> {
  return client.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account, spender],
  });
}

export async function prepareApprovalTransaction(
  connection: WalletConnection,
  config: BlockchainConfig,
): Promise<ApprovalDetails> {
  const client = await initializeTokenContract(config);
  const [name, symbol, decimals] = await Promise.all([
    getTokenName(client, config.tokenAddress),
    getTokenSymbol(client, config.tokenAddress),
    getTokenDecimals(client, config.tokenAddress),
  ]);
  if (symbol.toUpperCase() !== "USDT") {
    throw new Error(`Configured token reports symbol "${symbol}", not USDT.`);
  }

  const amount = calculateApprovalAmount(decimals);
  const [balance, allowance] = await Promise.all([
    getTokenBalance(client, config.tokenAddress, connection.address),
    getTokenAllowance(
      client,
      config.tokenAddress,
      connection.address,
      config.spenderAddress,
    ),
  ]);
  const data = encodeApprovalData(config.spenderAddress, amount);

  validateApprovalTransaction(
    connection.address,
    config,
    connection.chainId,
    amount,
    data,
    decimals,
  );
  return { tokenName: name, tokenSymbol: symbol, decimals, amount, balance, allowance, data };
}

export function encodeApprovalData(
  spender: `0x${string}`,
  amount: bigint,
): `0x${string}` {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, amount],
  });
}

export function validateApprovalTransaction(
  account: string,
  config: BlockchainConfig,
  chainId: number,
  amount: bigint,
  data: `0x${string}`,
  decimals: number,
): void {
  if (!isAddress(account, { strict: false })) {
    throw new Error("The connected account address is invalid.");
  }
  if (chainId !== config.chainId) {
    throw new Error("The wallet is not connected to BNB Smart Chain.");
  }
  const decoded = decodeFunctionData({ abi: erc20Abi, data });
  if (
    decoded.functionName !== "approve" ||
    decoded.args[0].toLowerCase() !== config.spenderAddress.toLowerCase() ||
    decoded.args[1] !== amount ||
    amount !== calculateApprovalAmount(decimals)
  ) {
    throw new Error("The prepared approval does not match the configured spender and amount.");
  }
  if (amount <= BigInt(0)) {
    throw new Error("The approval amount must be positive.");
  }
}

export async function submitApprovalTransaction(
  connection: WalletConnection,
  config: BlockchainConfig,
  approval: ApprovalDetails,
): Promise<Hash> {
  const chainId = await getCurrentChainId(connection.provider);
  validateApprovalTransaction(
    connection.address,
    config,
    chainId,
    approval.amount,
    approval.data,
    approval.decimals,
  );

  const result = await requestTransactionSignature(
    connection,
    config,
    approval.data,
  );
  return getTransactionHash(result);
}

export async function requestTransactionSignature(
  connection: WalletConnection,
  config: BlockchainConfig,
  data: `0x${string}`,
): Promise<unknown> {
  return connection.provider.request(
    {
      method: "eth_sendTransaction",
      params: [
        {
          from: connection.address,
          to: config.tokenAddress,
          data,
          value: "0x0",
        },
      ],
    },
    "eip155:56",
  );
}

export function getTransactionHash(result: unknown): Hash {
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result)) {
    throw new Error("The wallet returned an invalid transaction hash.");
  }
  return result as Hash;
}

export async function getTransactionReceipt(hash: Hash, config: BlockchainConfig) {
  const client = await initializeTokenContract(config);
  return client.getTransactionReceipt({ hash });
}

export async function verifyTransactionReceipt(
  hash: Hash,
  connection: WalletConnection,
  config: BlockchainConfig,
  approval: ApprovalDetails,
): Promise<void> {
  const client = await initializeTokenContract(config);
  const receipt = await client.getTransactionReceipt({ hash });
  const transaction = await client.getTransaction({ hash });
  if (
    receipt.transactionHash.toLowerCase() !== hash.toLowerCase() ||
    transaction.from.toLowerCase() !== connection.address.toLowerCase() ||
    transaction.to?.toLowerCase() !== config.tokenAddress.toLowerCase() ||
    transaction.value !== BigInt(0)
  ) {
    throw new Error("The confirmed transaction does not match the requested approval.");
  }
  validateApprovalTransaction(
    connection.address,
    config,
    config.chainId,
    approval.amount,
    transaction.input,
    approval.decimals,
  );
  if (receipt.status !== "success") {
    throw new Error("The approval transaction reverted on BNB Smart Chain.");
  }
}

export async function trackTransaction(
  hash: Hash,
  connection: WalletConnection,
  config: BlockchainConfig,
  approval: ApprovalDetails,
  onPending: () => void,
  timeoutMs = 120_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await verifyTransactionReceipt(hash, connection, config, approval);
      return;
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "TransactionReceiptNotFoundError") {
        throw error;
      }
      onPending();
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      continue;
    }
  }

  throw new Error("Transaction is still pending. Its final status was not determined.");
}

export function formatTokenAmount(amount: bigint, decimals: number): string {
  return formatUnits(amount, decimals);
}

import { getAddress, isAddress } from "viem";

export const BSC_CHAIN_ID = 56;
export const BSC_CAIP2 = "eip155:56";

export type BlockchainConfig = {
  chainId: typeof BSC_CHAIN_ID;
  rpcUrl: string;
  tokenAddress: `0x${string}`;
  spenderAddress: `0x${string}`;
  projectId: string;
};

function requiredValue(name: string, configuredValue: string | undefined): string {
  const value = configuredValue?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function requiredAddress(
  name: string,
  configuredValue: string | undefined,
): `0x${string}` {
  const value = requiredValue(name, configuredValue);
  if (!isAddress(value, { strict: false })) {
    throw new Error(`${name} must be a valid EVM address.`);
  }
  return getAddress(value);
}

export function loadBlockchainConfig(): BlockchainConfig {
  const configuredChainId = Number(
    requiredValue("NEXT_PUBLIC_CHAIN_ID", process.env.NEXT_PUBLIC_CHAIN_ID),
  );
  if (configuredChainId !== BSC_CHAIN_ID) {
    throw new Error("Only BNB Smart Chain Mainnet (chain ID 56) is supported.");
  }

  const rpcUrl = requiredValue("NEXT_PUBLIC_RPC_URL", process.env.NEXT_PUBLIC_RPC_URL);
  let parsedRpcUrl: URL;
  try {
    parsedRpcUrl = new URL(rpcUrl);
  } catch {
    throw new Error("NEXT_PUBLIC_RPC_URL must be a valid HTTP(S) URL.");
  }
  if (!["http:", "https:"].includes(parsedRpcUrl.protocol)) {
    throw new Error("NEXT_PUBLIC_RPC_URL must use HTTP or HTTPS.");
  }
  if (
    parsedRpcUrl.protocol === "http:" &&
    !["localhost", "127.0.0.1", "::1"].includes(parsedRpcUrl.hostname)
  ) {
    throw new Error("Use HTTPS for non-local RPC endpoints.");
  }

  const tokenAddress = requiredAddress(
    "NEXT_PUBLIC_TOKEN_CONTRACT_ADDRESS",
    process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ADDRESS,
  );
  const spenderAddress = requiredAddress(
    "NEXT_PUBLIC_SPENDER_CONTRACT_ADDRESS",
    process.env.NEXT_PUBLIC_SPENDER_CONTRACT_ADDRESS,
  );
  if (tokenAddress.toLowerCase() === spenderAddress.toLowerCase()) {
    throw new Error("The token and spender contract addresses must be different.");
  }

  const projectId = requiredValue(
    "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID",
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
  );
  if (!/^[\da-f]{32}$/i.test(projectId)) {
    throw new Error("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID must be a 32-character hexadecimal ID.");
  }

  return {
    chainId: BSC_CHAIN_ID,
    rpcUrl: parsedRpcUrl.toString(),
    tokenAddress,
    spenderAddress,
    projectId,
  };
}

export function calculateApprovalAmount(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("Token decimals must be an integer between 0 and 255.");
  }
  return BigInt(10) ** BigInt(decimals);
}

export function extractWalletAddress(
  accounts: readonly string[],
): `0x${string}` {
  const account = accounts.find((value) => value.startsWith(`${BSC_CAIP2}:`));
  const address = account?.slice(`${BSC_CAIP2}:`.length);
  if (!address || !isAddress(address, { strict: false })) {
    throw new Error("The connected wallet did not provide a valid BNB Chain account.");
  }
  return getAddress(address);
}

export function generateTrustWalletDeepLink(uri: string): string {
  if (!uri.startsWith("wc:")) {
    throw new Error("WalletConnect returned an invalid connection URI.");
  }
  return `trust://wc?uri=${encodeURIComponent(uri)}`;
}

export function generateTrustWalletLaunchUrl(
  uri: string,
  userAgent: string,
): string {
  const deepLink = generateTrustWalletDeepLink(uri);
  if (!/android/i.test(userAgent)) {
    return deepLink;
  }

  const playStoreUrl =
    "https://play.google.com/store/apps/details?id=com.wallet.crypto.trustapp";
  return `intent://wc?uri=${encodeURIComponent(uri)}#Intent;scheme=trust;package=com.wallet.crypto.trustapp;S.browser_fallback_url=${encodeURIComponent(playStoreUrl)};end`;
}

export function isSupportedMobileDevice(userAgent: string): boolean {
  return /android|iphone|ipad|ipod/i.test(userAgent);
}

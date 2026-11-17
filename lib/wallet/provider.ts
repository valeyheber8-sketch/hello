import type UniversalProvider from "@walletconnect/universal-provider";
import type { SessionTypes } from "@walletconnect/types";
import {
  BSC_CAIP2,
  BSC_CHAIN_ID,
  type BlockchainConfig,
  extractWalletAddress,
  generateTrustWalletDeepLink,
  isSupportedMobileDevice,
} from "./config";

type WalletMetadata = {
  name: string;
  description: string;
  url: string;
  icons: string[];
};

export function configureWalletMetadata(): WalletMetadata {
  if (typeof window === "undefined") {
    throw new Error("Wallet metadata is only available in a browser.");
  }
  return {
    name: "Check Now",
    description: "Check Now",
    url: window.location.origin,
    icons: [],
  };
}

export function configureChains(config: BlockchainConfig) {
  return {
    eip155: {
      chains: [BSC_CAIP2],
      methods: ["eth_sendTransaction"],
      events: ["accountsChanged", "chainChanged"],
      rpcMap: { [BSC_CAIP2]: config.rpcUrl },
    },
  };
}

export type WalletConnection = {
  provider: UniversalProvider;
  address: `0x${string}`;
  chainId: number;
};

let providerPromise: Promise<UniversalProvider> | undefined;

export async function initializeProvider(
  config: BlockchainConfig,
): Promise<UniversalProvider> {
  if (typeof window === "undefined") {
    throw new Error("Wallet initialization is only available in a browser.");
  }

  if (!providerPromise) {
    providerPromise = import("@walletconnect/universal-provider")
      .then(({ default: Provider }) =>
        Provider.init({
          projectId: config.projectId,
          logger: "error",
          metadata: configureWalletMetadata(),
        }),
      )
      .catch((error: unknown) => {
        providerPromise = undefined;
        throw new Error(`Wallet provider initialization failed: ${errorMessage(error)}`);
      });
  }
  return providerPromise;
}

export async function initializeTrustWalletConnection(
  provider: UniversalProvider,
  config: BlockchainConfig,
): Promise<WalletConnection> {
  if (!isSupportedMobileDevice(window.navigator.userAgent)) {
    throw new Error("Wallet connection is available on mobile devices only.");
  }

  try {
    const session = await provider.connect({ namespaces: configureChains(config) });
    if (!session) {
      throw new Error("Trust Wallet did not establish a WalletConnect session.");
    }

    return await validateWalletConnection(provider, session);
  } catch (error) {
    throw new Error(`Trust Wallet connection failed: ${errorMessage(error)}`);
  }
}

export async function connectToTrustWallet(
  provider: UniversalProvider,
  config: BlockchainConfig,
): Promise<WalletConnection> {
  let deepLinkError: Error | undefined;
  const uriHandler = (uri: string) => {
    try {
      handleDisplayUri(uri);
    } catch (error) {
      deepLinkError = new Error(`Could not open Trust Wallet: ${errorMessage(error)}`);
      provider.abortPairingAttempt();
    }
  };
  provider.once("display_uri", uriHandler);
  try {
    try {
      const connection = await initializeTrustWalletConnection(provider, config);
      if (deepLinkError) {
        throw deepLinkError;
      }
      return connection;
    } catch (error) {
      if (deepLinkError) {
        throw deepLinkError;
      }
      throw error;
    }
  } finally {
    provider.removeListener("display_uri", uriHandler);
  }
}

export function handleDisplayUri(uri: string): void {
  openTrustWallet(uri);
}

export function openTrustWallet(uri: string): void {
  if (
    typeof window === "undefined" ||
    !isSupportedMobileDevice(window.navigator.userAgent)
  ) {
    throw new Error("Trust Wallet deep links are supported on mobile devices only.");
  }
  window.location.assign(generateTrustWalletDeepLink(uri));
}

export async function restoreWalletSession(
  provider: UniversalProvider,
): Promise<WalletConnection | null> {
  const session = getWalletSession(provider);
  if (!session) {
    return null;
  }
  return validateWalletConnection(provider, session);
}

export function getWalletSession(
  provider: UniversalProvider,
): SessionTypes.Struct | null {
  return provider.session ?? null;
}

export async function validateWalletConnection(
  provider: UniversalProvider,
  session: SessionTypes.Struct,
): Promise<WalletConnection> {
  const accounts = session.namespaces.eip155?.accounts ?? [];
  const address = extractWalletAddress(accounts);
  const chainId = await getCurrentChainId(provider);
  if (chainId !== BSC_CHAIN_ID) {
    throw new Error("Switch Trust Wallet to BNB Smart Chain (chain ID 56) and try again.");
  }
  return { provider, address, chainId };
}

export async function getCurrentChainId(
  provider: UniversalProvider,
): Promise<number> {
  const result = await provider.request({ method: "eth_chainId" });
  const chainId =
    typeof result === "string"
      ? Number.parseInt(result, result.startsWith("0x") ? 16 : 10)
      : Number(result);
  if (!Number.isInteger(chainId)) {
    throw new Error("Could not read the connected wallet's chain ID.");
  }
  return chainId;
}

export async function disconnectWallet(
  provider: UniversalProvider,
): Promise<void> {
  await provider.disconnect();
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as Error & { code?: number }).code;
    if (code === 4001) {
      return "The request was rejected in Trust Wallet.";
    }
    return error.message;
  }
  return "An unexpected wallet error occurred.";
}

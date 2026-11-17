"use client";

import { useEffect, useRef, useState } from "react";
import type UniversalProvider from "@walletconnect/universal-provider";
import type { Hash } from "viem";
import {
  type BlockchainConfig,
  BSC_CHAIN_ID,
  isSupportedMobileDevice,
  loadBlockchainConfig,
} from "@/lib/wallet/config";
import {
  connectToTrustWallet,
  disconnectWallet,
  errorMessage,
  initializeProvider,
  restoreWalletSession,
  type WalletConnection,
} from "@/lib/wallet/provider";
import {
  formatTokenAmount,
  prepareApprovalTransaction,
  submitApprovalTransaction,
  trackTransaction,
  type ApprovalDetails,
} from "@/lib/wallet/token";
import { parsePendingApproval } from "@/lib/wallet/pending";

const pendingApprovalStorageKey = "check-now:pending-approval";

type Status =
  | "idle"
  | "connecting"
  | "review"
  | "submitting"
  | "tracking"
  | "success"
  | "pending";

export default function CheckNow() {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [connection, setConnection] = useState<WalletConnection | null>(null);
  const [approval, setApproval] = useState<ApprovalDetails | null>(null);
  const [transactionHash, setTransactionHash] = useState<Hash | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const providerRef = useRef<UniversalProvider | null>(null);
  const configRef = useRef<BlockchainConfig | null>(null);
  const operationRef = useRef(false);

  useEffect(() => {
    try {
      const saved = parsePendingApproval(
        window.sessionStorage.getItem(pendingApprovalStorageKey),
      );
      if (saved) {
        setTransactionHash(saved.hash);
        setStatus("pending");
        setMessage("A submitted transaction was saved. Select Check Now to reconnect and verify its status.");
      }
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    const provider = providerRef.current;
    if (!provider) {
      return;
    }

    const onAccountsChanged = () => {
      setConnection(null);
      setApproval(null);
      setConfirmed(false);
      setStatus("idle");
      setMessage("The connected account changed. Select Check Now to verify the new account.");
    };
    const onChainChanged = (chain: string) => {
      const chainValue = chain.startsWith("eip155:")
        ? chain.slice("eip155:".length)
        : chain;
      const currentChain =
        chainValue === BSC_CHAIN_ID.toString()
          ? BSC_CHAIN_ID
          : Number.parseInt(
              chainValue,
              chainValue.startsWith("0x") ? 16 : 10,
            );
      setApproval(null);
      setConfirmed(false);
      if (currentChain !== BSC_CHAIN_ID) {
        setStatus("idle");
        setMessage("Network changed. Switch to BNB Smart Chain and select Check Now again.");
      }
    };
    const onDisconnect = () => {
      setConnection(null);
      setApproval(null);
      setConfirmed(false);
      setStatus("idle");
      setMessage("The wallet session ended.");
    };
    const onConnect = () => {
      setMessage("Wallet session established. Verifying account and network…");
    };
    const onSessionUpdate = () => {
      setApproval(null);
      setConfirmed(false);
      setMessage("The wallet session changed. Select Check Now to refresh its details.");
    };
    const onSessionDelete = () => onDisconnect();

    provider.on("accountsChanged", onAccountsChanged);
    provider.on("chainChanged", onChainChanged);
    provider.on("connect", onConnect);
    provider.on("disconnect", onDisconnect);
    provider.client.on("session_update", onSessionUpdate);
    provider.client.on("session_delete", onSessionDelete);

    return () => {
      provider.removeListener("accountsChanged", onAccountsChanged);
      provider.removeListener("chainChanged", onChainChanged);
      provider.removeListener("connect", onConnect);
      provider.removeListener("disconnect", onDisconnect);
      provider.client.off("session_update", onSessionUpdate);
      provider.client.off("session_delete", onSessionDelete);
    };
  }, [connection]);

  async function checkNow() {
    if (operationRef.current) {
      return;
    }
    operationRef.current = true;
    setBusy(true);
    setMessage("");
    setApproval(null);
    setConfirmed(false);

    try {
      if (!isSupportedMobileDevice(window.navigator.userAgent)) {
        throw new Error("Trust Wallet connection is supported on mobile devices only.");
      }

      const config = loadBlockchainConfig();
      configRef.current = config;
      setStatus("connecting");
      setMessage("Connecting to Trust Wallet on BNB Smart Chain…");

      const provider = await initializeProvider(config);
      providerRef.current = provider;
      const activeConnection =
        (await restoreWalletSession(provider)) ??
        (await connectToTrustWallet(provider, config));
      setConnection(activeConnection);

      const saved = parsePendingApproval(
        window.sessionStorage.getItem(pendingApprovalStorageKey),
      );
      if (saved) {
        setTransactionHash(saved.hash);
        if (saved.account.toLowerCase() !== activeConnection.address.toLowerCase()) {
          setApproval(null);
          setStatus("pending");
          setMessage(
            `A pending transaction belongs to ${saved.account}. Reconnect that account to verify it; no additional approval will be requested.`,
          );
          return;
        }
        const details = await prepareApprovalTransaction(activeConnection, config);
        setApproval(details);
        setStatus("pending");
        await verifyTransaction(saved.hash, activeConnection, config, details);
        return;
      }

      const details = await prepareApprovalTransaction(activeConnection, config);
      setApproval(details);
      setStatus("review");
      setMessage("Review the approval details. No transaction has been sent.");
    } catch (error) {
      setStatus("idle");
      setMessage(errorMessage(error));
    } finally {
      operationRef.current = false;
      setBusy(false);
    }
  }

  async function approve() {
    if (
      !connection ||
      !approval ||
      !configRef.current ||
      !confirmed ||
      transactionHash ||
      operationRef.current
    ) {
      return;
    }
    const accepted = window.confirm(
      `Approve exactly 1 USDT for spender ${configRef.current.spenderAddress} on BNB Smart Chain?`,
    );
    if (!accepted) {
      setMessage("Approval was cancelled. No transaction was sent.");
      return;
    }

    operationRef.current = true;
    setBusy(true);
    setStatus("submitting");
    setMessage("Waiting for your confirmation in Trust Wallet…");
    try {
      const hash = await submitApprovalTransaction(
        connection,
        configRef.current,
        approval,
      );
      setTransactionHash(hash);
      window.sessionStorage.setItem(
        pendingApprovalStorageKey,
        JSON.stringify({ hash, account: connection.address }),
      );
      await verifyTransaction(hash, connection, configRef.current, approval);
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes("still pending")) {
        setStatus("pending");
      } else {
        setStatus("idle");
      }
      setMessage(message);
    } finally {
      operationRef.current = false;
      setBusy(false);
    }
  }

  async function verifyTransaction(
    hash: Hash,
    activeConnection: WalletConnection,
    config: BlockchainConfig,
    details: ApprovalDetails,
  ) {
    setStatus("tracking");
    setMessage("Transaction submitted. Waiting for a verified BNB Chain receipt…");
    await trackTransaction(
      hash,
      activeConnection,
      config,
      details,
      () => setMessage("Transaction is pending on BNB Smart Chain…"),
    );
    window.sessionStorage.removeItem(pendingApprovalStorageKey);
    setStatus("success");
    setMessage(
      "The 1 USDT approval was confirmed. Certificate generation is unavailable because its original implementation was not present in the workspace.",
    );
  }

  async function recheckTransaction() {
    if (!transactionHash || !connection || !approval || !configRef.current || operationRef.current) {
      return;
    }
    operationRef.current = true;
    setBusy(true);
    try {
      await verifyTransaction(
        transactionHash,
        connection,
        configRef.current,
        approval,
      );
    } catch (error) {
      const message = errorMessage(error);
      setStatus(message.includes("still pending") ? "pending" : "idle");
      setMessage(message);
    } finally {
      operationRef.current = false;
      setBusy(false);
    }
  }

  async function disconnect() {
    const provider = providerRef.current;
    if (!provider || busy) {
      return;
    }
    setBusy(true);
    try {
      await disconnectWallet(provider);
      setConnection(null);
      setApproval(null);
      setConfirmed(false);
      setStatus("idle");
      setMessage("Wallet disconnected.");
    } catch (error) {
      setMessage(`Wallet disconnect failed: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <section className="check-panel" aria-live="polite">
        <button
          id="check-now"
          type="button"
          onClick={checkNow}
          disabled={busy || status === "success"}
        >
          {busy && status === "connecting" ? "Connecting…" : "Check Now"}
        </button>

        {message && (
          <p className="status-message" role="status">
            {message}
          </p>
        )}

        {connection && (
          <p className="wallet-address">
            Connected account: <code>{connection.address}</code>
          </p>
        )}

        {approval && configRef.current && (
          <div className="approval-details">
            <h1>Review token approval</h1>
            <dl>
              <dt>Network</dt>
              <dd>BNB Smart Chain (56)</dd>
              <dt>Token</dt>
              <dd>{approval.tokenName} ({approval.tokenSymbol})</dd>
              <dt>Token contract</dt>
              <dd>
                <code>{configRef.current.tokenAddress}</code>
              </dd>
              <dt>Spender</dt>
              <dd>
                <code>{configRef.current.spenderAddress}</code>
              </dd>
              <dt>Approval amount</dt>
              <dd>Exactly {formatTokenAmount(approval.amount, approval.decimals)} {approval.tokenSymbol}</dd>
              <dt>Current balance</dt>
              <dd>{formatTokenAmount(approval.balance, approval.decimals)} {approval.tokenSymbol}</dd>
              <dt>Current allowance</dt>
              <dd>{formatTokenAmount(approval.allowance, approval.decimals)} {approval.tokenSymbol}</dd>
            </dl>
            <p>
              This grants the spender permission to use up to the displayed amount
              of this token. It is not an unlimited approval.
            </p>
            {status !== "success" && (
              <>
                <label className="confirmation">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    disabled={busy}
                  />
                  I have reviewed these details and want to request this approval.
                </label>
                <button
                  type="button"
                  onClick={approve}
                  disabled={!confirmed || busy || Boolean(transactionHash)}
                >
                  Approve exactly 1 USDT in Trust Wallet
                </button>
              </>
            )}
          </div>
        )}

        {transactionHash && (
          <p className="transaction-hash">
            Transaction: <code>{transactionHash}</code>
          </p>
        )}
        {transactionHash && status !== "success" && (
          <button
            type="button"
            onClick={recheckTransaction}
            disabled={busy || !connection || !approval}
          >
            Check transaction status
          </button>
        )}
        {connection && (
          <button className="secondary-button" type="button" onClick={disconnect} disabled={busy}>
            Disconnect wallet
          </button>
        )}
      </section>
    </main>
  );
}

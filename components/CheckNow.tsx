"use client";

import { useEffect, useRef, useState } from "react";
import type UniversalProvider from "@walletconnect/universal-provider";
import type { Hash } from "viem";
import {
  type BlockchainConfig,
  BSC_CHAIN_ID,
  generateTrustWalletDeepLink,
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
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [walletUri, setWalletUri] = useState<string | null>(null);
  const providerRef = useRef<UniversalProvider | null>(null);
  const configRef = useRef<BlockchainConfig | null>(null);
  const operationRef = useRef(false);
  const cancelConnectionRef = useRef(false);

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
    cancelConnectionRef.current = false;
    setBusy(true);
    setMessage("");
    setApproval(null);
    setConfirmed(false);
    setWalletUri(null);

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
      const restoredConnection = await restoreWalletSession(provider);
      let activeConnection = restoredConnection;
      if (!activeConnection) {
        setWalletModalOpen(true);
        activeConnection = await connectToTrustWallet(
          provider,
          config,
          setWalletUri,
        );
      }
      if (cancelConnectionRef.current) {
        throw new Error("Wallet connection cancelled.");
      }
      setWalletModalOpen(false);
      setWalletUri(null);
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
      setWalletModalOpen(false);
      setWalletUri(null);
      setStatus("idle");
      setMessage(
        cancelConnectionRef.current
          ? "Wallet connection cancelled."
          : errorMessage(error),
      );
    } finally {
      cancelConnectionRef.current = false;
      operationRef.current = false;
      setBusy(false);
    }
  }

  function cancelWalletConnection() {
    const provider = providerRef.current;
    if (!provider || !walletModalOpen) {
      return;
    }

    try {
      cancelConnectionRef.current = true;
      provider.abortPairingAttempt();
      setWalletModalOpen(false);
      setWalletUri(null);
      setMessage("Cancelling wallet connection…");
    } catch (error) {
      cancelConnectionRef.current = false;
      setMessage(`Could not cancel wallet connection: ${errorMessage(error)}`);
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
    setMessage("The 1 USDT approval was confirmed on BNB Smart Chain.");
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
    <>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Check Now home">
          <span className="brand-mark" aria-hidden="true">C</span>
          <span>Check Now<small>BNB Smart Chain</small></span>
        </a>
        <nav className="site-nav" aria-label="Main navigation">
          <a href="#check">Check Now</a>
          <a href="#about">About</a>
          <a href="#process">How it works</a>
          <a href="#faq">FAQ</a>
        </nav>
        <a className="header-link" href="#check">Open check</a>
      </header>

      <main id="top">
        <section className="hero-section">
          <div className="hero-copy">
            <p className="eyebrow"><span aria-hidden="true">●</span> BNB Smart Chain · USDT</p>
            <h1>Review your USDT approval before you sign.</h1>
            <p className="hero-description">
              Connect Trust Wallet to inspect your BNB Chain USDT balance and
              allowance. If you choose to continue, the requested approval is
              limited to exactly 1 USDT.
            </p>
            <ul className="hero-points">
              <li><span aria-hidden="true">✓</span> Connection does not submit a transaction</li>
              <li><span aria-hidden="true">✓</span> Spender and amount shown before approval</li>
              <li><span aria-hidden="true">✓</span> Approval requires separate confirmation</li>
            </ul>
            <a className="hero-link" href="#check">Continue to Check Now <span aria-hidden="true">↓</span></a>
          </div>
          <aside className="hero-note">
            <div className="note-icon" aria-hidden="true">i</div>
            <h2>This is an approval flow, not a security scan.</h2>
            <p>
              It does not assess whether a wallet is safe or issue a security
              certificate. Review the token and spender addresses carefully.
            </p>
            <div className="network-chip"><span aria-hidden="true">●</span> BNB Smart Chain · 56</div>
          </aside>
        </section>

        <section className="feature-strip" aria-label="Approval flow safeguards">
          <article>
            <span className="feature-number">01</span>
            <div><h2>Read first</h2><p>Review the account, balance, and current allowance.</p></div>
          </article>
          <article>
            <span className="feature-number">02</span>
            <div><h2>Fixed amount</h2><p>The requested approval is exactly 1 USDT, never unlimited.</p></div>
          </article>
          <article>
            <span className="feature-number">03</span>
            <div><h2>You decide</h2><p>No transaction is sent until you confirm and authorize it.</p></div>
          </article>
        </section>

        <section id="check" className="check-section">
          <div className="section-heading">
            <p className="eyebrow">Wallet check</p>
            <h2>Connect and review</h2>
            <p>Use Trust Wallet on a mobile device. You can disconnect at any time.</p>
          </div>
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
                <h2>Review token approval</h2>
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
                <p className="approval-warning">
                  Approval lets the named spender use up to this amount of your
                  USDT. It does not transfer tokens now, but it grants on-chain
                  permission. Only proceed if you trust the displayed spender.
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
                      I reviewed the token, spender, and exact 1 USDT amount.
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
        </section>

        <section id="about" className="info-section">
          <div className="section-heading">
            <p className="eyebrow">What this page does</p>
            <h2>A clear, limited wallet interaction</h2>
          </div>
          <p className="info-copy">
            This page connects to your wallet through WalletConnect and reads
            public BNB Chain contract data using the configured RPC endpoint.
            It displays the token contract, spender, token balance, and current
            allowance so you can review them before deciding whether to request
            an approval. It does not provide scam detection, risk scoring, or
            a guarantee about wallet security.
          </p>
        </section>

        <section id="process" className="process-section">
          <div className="section-heading">
            <p className="eyebrow">How it works</p>
            <h2>Four steps, with your confirmation</h2>
          </div>
          <ol className="steps-list">
            <li><span>01</span><div><h3>Connect</h3><p>Start a WalletConnect session with Trust Wallet on BNB Smart Chain.</p></div></li>
            <li><span>02</span><div><h3>Review</h3><p>Check the configured token and spender, plus your balance and existing allowance.</p></div></li>
            <li><span>03</span><div><h3>Choose</h3><p>Only after you check the confirmation box can the wallet be asked to approve exactly 1 USDT.</p></div></li>
            <li><span>04</span><div><h3>Verify</h3><p>If you authorize the transaction, its BNB Chain receipt and transaction fields are checked.</p></div></li>
          </ol>
        </section>

        <section id="faq" className="faq-section">
          <div className="section-heading">
            <p className="eyebrow">FAQ</p>
            <h2>Questions before connecting?</h2>
          </div>
          <div className="faq-list">
            <details>
              <summary>Does connecting my wallet send a transaction?</summary>
              <p>No. Connecting reads your account and network and fetches public token details. A transaction is requested only after a separate confirmation and your approval in Trust Wallet.</p>
            </details>
            <details>
              <summary>What does the approval allow?</summary>
              <p>It allows the displayed spender to use up to exactly 1 USDT from the connected account. An approval is not a token transfer, but it is an on-chain permission. Verify the spender before signing.</p>
            </details>
            <details>
              <summary>Does this check whether my wallet is safe?</summary>
              <p>No. It reads token information and allowance only. It does not analyze wallet risk, detect scams, or issue a security certificate.</p>
            </details>
            <details>
              <summary>Will I ever be asked for my recovery phrase?</summary>
              <p>No. Never share your recovery phrase or private key with a website, support agent, or wallet connection.</p>
            </details>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <a className="brand" href="#top">
          <span className="brand-mark" aria-hidden="true">C</span>
          <span>Check Now<small>BNB Smart Chain</small></span>
        </a>
        <p>Review every wallet request carefully. This page is not a security audit or financial advice.</p>
        <a href="#top">Back to top ↑</a>
      </footer>

      {walletModalOpen && (
        <div className="wallet-modal-backdrop">
          <section
            className="wallet-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-modal-title"
          >
            <button
              className="wallet-modal-close"
              type="button"
              onClick={cancelWalletConnection}
              aria-label="Cancel wallet connection"
            >
              ×
            </button>
            <div className="wallet-modal-icon" aria-hidden="true">↗</div>
            <p className="eyebrow">WalletConnect</p>
            <h2 id="wallet-modal-title">Connect Trust Wallet</h2>
            <p>
              {walletUri
                ? "Open Trust Wallet and approve this connection request. No token transaction is sent when you connect."
                : "Preparing a secure WalletConnect request…"}
            </p>
            {walletUri && (
              <a
                className="wallet-modal-action"
                href={generateTrustWalletDeepLink(walletUri)}
              >
                Open Trust Wallet
              </a>
            )}
            <button
              className="secondary-button wallet-modal-cancel"
              type="button"
              onClick={cancelWalletConnection}
            >
              Cancel
            </button>
          </section>
        </div>
      )}
    </>
  );
}

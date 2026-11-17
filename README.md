# Check Now

Minimal Next.js frontend with a mobile-only Trust Wallet connection and an
explicitly confirmed, fixed 1 USDT approval workflow on BNB Smart Chain.

## Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local`.
3. Configure an HTTPS BNB Smart Chain RPC URL and the verified USDT token and
   spender addresses. The token must report the `USDT` symbol. The app rejects
   missing or invalid values and never supplies fallback contract addresses.
4. Configure a WalletConnect project ID for your deployment.
5. Start the app with `npm run dev`.

All `NEXT_PUBLIC_` values are shipped to the browser. They must not contain
private keys or other secrets. Contract addresses and RPC configuration must be
verified before use.

The app only prepares an approval for exactly `1 × 10^tokenDecimals`; it never
requests unlimited approval. It displays the token, spender, network, amount,
balance, and existing allowance, requires a separate confirmation, then
requests wallet authorization. A transaction is reported as successful only
after its BNB Chain receipt and transaction fields are verified. No transaction
is submitted during connection.

## Outstanding source requirements

The workspace originally contained no frontend source beyond the minimal
Check Now page. Consequently, the original certificate generator, loading
sequence, and prior UI cannot be preserved or integrated. Provide that source
before adding certificate behavior; the app does not generate or claim a
certificate.

Live wallet and blockchain behavior requires valid environment configuration
and testing in Trust Wallet on a mobile device. The implementation does not
provide desktop wallet support or an injected-provider fallback.

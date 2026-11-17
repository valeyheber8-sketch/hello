# Check Now

A BNB Smart Chain wallet flow for reviewing USDT token details and, only if
explicitly confirmed, requesting an approval for exactly 1 USDT.

## Setup

1. Install dependencies with `npm install`.
2. Set these values in a root `.env.local` file:
   - `NEXT_PUBLIC_CHAIN_ID=56`
   - `NEXT_PUBLIC_RPC_URL` to an HTTPS BNB Smart Chain RPC endpoint
   - `NEXT_PUBLIC_TOKEN_CONTRACT_ADDRESS` to the verified USDT contract
   - `NEXT_PUBLIC_SPENDER_CONTRACT_ADDRESS` to the contract that will receive
     the allowance
   - `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` to your WalletConnect project ID
3. Verify the token and spender addresses before use.
4. Start the app with `npm run dev`.

All `NEXT_PUBLIC_` values are included in browser code. Do not put private keys,
recovery phrases, or other secrets in them.

## Wallet flow

The Check Now action connects to Trust Wallet on mobile and reads the connected
account, token details, USDT balance, and existing allowance. Connecting does
not submit a transaction. The app displays the token and spender addresses and
requires an additional confirmation before asking the wallet to approve exactly
`1 × 10^tokenDecimals` units of USDT. It does not request unlimited approval or
send BNB. Submitted transactions are reported as confirmed only after their
BNB Chain transaction and receipt are verified.

This is not a wallet security scan and does not provide scam detection, risk
scores, or security certificates. Wallet addresses and balances are public
blockchain data; requests are made through the configured RPC endpoint and
WalletConnect.

Run the wallet tests with `npm test`.

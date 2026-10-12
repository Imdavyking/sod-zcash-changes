# Sod on Zcash

**Private crowdfunding with all-or-nothing refunds, on Zcash.**

Donors pay shielded ZEC from any Zcash wallet. A group of independent signers holds the escrow key (FROST threshold signatures). Before releasing a single zatoshi, each signer re-derives the spend from the campaign rules and signs only its own derivation. Goal met by the deadline: the creator is paid. Goal missed: every donor can reclaim their donation.

> Prototype. Not audited. The signer, chain and spend layers are implemented against a mock network (see [Going live](#going-live)). Do not use real funds.

Zcash L1 has no smart contracts, so the rules live in a policy engine (`src/core/policy.ts`) that every signer runs independently, and the escrow key is split t-of-n with FROST.

## Protocol

1. **Create.** The creator submits `{name, description, imageURI, goal, deadline, creatorAddress, nonce}`. The campaign id is `SHA-256` of that record, every signer re-validates and registers it, and the campaign gets its own escrow address (a diversified address of the group key, diversifier = first 11 bytes of the id). The payout address is fixed here.
2. **Donate.** The browser makes a random `secret` and computes `commitment = SHA-256("sod/refund/v1" ‖ campaignId ‖ secret ‖ len(refundTo) ‖ refundTo)`. The donor pays the escrow address with the text memo `sod1:<commitment>`. A Zcash payment reveals no sender, so `refundTo` (a shielded address) is supplied up front and locked into the commitment.
3. **Refund.** Donor reveals `secret` and `refundTo`. Signers find the unspent note whose memo commitment matches and spend it (minus the ZIP-317 fee) to `refundTo`.
   - On-time donation, before the deadline: always.
   - On-time donation, after the deadline: once settled, only if the goal was missed.
   - Donation mined after the deadline: any time (it was never counted).
4. **Settle and pay out.** `SETTLE_DELAY_SEC` (15 min) after the deadline, if the frozen total reaches the goal, anyone may trigger the payout. Signers sweep every counted note to the creator address.

**Frozen total.** The total is the sum of counted donations still in escrow at the deadline. Refunds before the deadline reduce it; refunds and the payout after it do not, so the goal check can't flip after the deadline.

**Counted** means: valid memo, positive value, mined before the deadline, and at least `MIN_CONFIRMATIONS` (3) deep. A payment without a valid memo is neither counted nor refundable (nobody can prove it is theirs), so the UI always supplies the memo.

**Signer independence.** `SignerNode` never signs what the coordinator sends. It reads the chain through its own node, recomputes the `SpendPlan`, and releases a share only over that plan. The spender needs `t` identical plan hashes. The coordinator holds no key material.

## Trust and privacy

| Property | Status |
| --- | --- |
| Donor identity and amounts on-chain | Hidden (shielded) |
| Donation amounts, refund addresses | **Visible to the signers** (they hold the group viewing key) |
| Running total | Hidden by the coordinator until the deadline (`SOD_REVEAL_TOTALS=live` to show it) |
| Creator payout address | Public on the campaign page; shielded on-chain |
| Funds safety | Needs fewer than `t` of `n` signers colluding. **Weaker than a contract**: `t` colluding signers can drain the escrow (tested in `test/quorum.test.ts`) |
| Liveness | Needs `t` signers online to refund or pay out |
| Late or memo-less payments | Memo-less payments are stuck; late ones are refundable |

## Running it

```bash
npm install
npm test            # 45 tests
npm run typecheck
npm run dev         # demo server on :8787: fake Zcash network, 3-of-5 mock signers
```

Frontend (separate project, `frontend/`):

```bash
cd frontend && npm install && npm run dev   # proxies /api to :8787
```

With the demo server the app shows Demo controls on each campaign so you can stand in for a wallet and skip the deadline. `GET /api/config` reports `network: "mock"` and the controls disappear on a real network.

### API

| Route | |
| --- | --- |
| `GET /api/config` | network, confirmations, settlement delay |
| `GET /api/campaigns`, `GET /api/campaigns/:id` | campaign views |
| `POST /api/campaigns` | create `{name, description, imageURI, goalZat, deadline, creatorAddress, nonce}` |
| `GET /api/campaigns/:id/donations/:commitment` | `unknown` / `held` / `late` / `refunded` |
| `POST /api/campaigns/:id/refund` | `{secret, refundTo}` |
| `POST /api/campaigns/:id/withdraw` | releases the payout |

## Testnet (single-key mode)

`npm run start` runs against real Zcash testnet: [Zebra](https://github.com/ZcashFoundation/zebra) for chain data and [Zallet](https://github.com/zcash/wallet) for the escrow wallet. Copy `.env.example` to `.env` and set the RPC URLs and credentials.

1. Run Zebra on testnet with its RPC enabled, and let it sync.
2. Run Zallet on testnet, create an account (`z_getnewaccount`), and note its number as `ESCROW_ACCOUNT`.
3. Fund nothing: donors fund campaigns. Get testnet coins (TAZ) for the donor wallet from a faucet.
4. `npm run start`, then point the frontend at it (`VITE_SOD_API` or the dev proxy).

How it works: each campaign gets its own Orchard-only unified address from `z_getaddressforaccount`. Donations are read with `z_listreceivedbyaddress`. Refunds and payouts are sent with `z_sendmany` after the signer logic approves them.

**This is custodial and testnet-only.** One wallet holds the key, so the operator can take the money, and there is no FROST. The server refuses to start on `mainnet`. The wallet chooses its own notes when it sends, so "which donation was paid" is tracked in `data/ledger.json`; notes at one campaign address are interchangeable, so funds still balance. A donation is marked paid before the send is queued, so a crash or retry can't pay it twice. If a send's outcome is unknown, the notes stay reserved and the server tells you to check the wallet.

**Not verified against a live node.** The adapter follows the [zcashd RPC docs](https://zcash.github.io/rpc/) and is tested against a fake node that speaks those shapes. Zallet is still porting zcashd methods, so a method may be missing or differ; the error names the method. Likely first fixes: `getblockchaininfo` / `getblock` on your Zebra build (chain tip and block time), `z_listreceivedbyaddress` (memo and spent handling), and the `z_sendmany` privacy policy for your recipient type.

## Going live (trustless)

What is real and tested here: the rules, the commitment scheme, memo format, quorum logic, the coordinator and API, and the frontend. What is **not** here, because it needs a Zcash node and cannot be exercised in a sandbox:

1. **FROST group.** Run a distributed key generation for RedPallas (ZF's [`frost`](https://github.com/ZcashFoundation/frost) crates, `frost-rerandomized`) to get the group spend-authorizing key and its full viewing key.
2. **`ChainView`.** Implement `tip()` and `notes(campaignId)` against a watch-only wallet that holds the group viewing key (Zallet or `zcash_client_backend` on Zebra). It must return, per received note: id, value, decoded text memo, mined height and block time, and the spending tx with its block time (needed for the frozen total). Each signer should run its own node.
3. **`EscrowAddresses`.** Derive the campaign's diversified unified address (Orchard receiver) from the group FVK at `diversifierIndex(id)`.
4. **`ThresholdSpender`.** Replace `MockThresholdSpender`: build the Orchard transaction for the approved `SpendPlan` with librustzcash, run a rerandomized FROST signing round where each signer's share comes from its own `SignerNode.approve*` result, then broadcast. `SignerNode.share` is a placeholder MAC today.

Also before real money: an audit, signer operations (key custody, monitoring, rotation), rate limiting on the API, and a decision about what happens to memo-less payments.

## Layout

```
sod-zcash/
├── src/core/        types, limits, crypto (commitment, ids), memo, policy (all the rules)
├── src/chain/       MockChain (fake network), zcashRpc.ts (Zebra + Zallet adapter)
├── src/signer/      SignerNode
├── src/threshold/   ThresholdSpender interface + MockThresholdSpender
├── src/coordinator/ Coordinator + HTTP server
├── src/dev.ts       demo server (fake network)
├── src/server.ts    testnet server (Zebra + Zallet, single-key)
├── test/            45 tests
└── frontend/        React + Tailwind
```

## License

MIT

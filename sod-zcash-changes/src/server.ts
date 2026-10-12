/**
 * Testnet server: Zebra for chain data, Zallet for the escrow wallet (single-key mode, see README).
 *
 *   SOD_NETWORK=testnet ZEBRA_RPC_URL=http://127.0.0.1:18232 ZALLET_RPC_URL=http://127.0.0.1:28232 \
 *   ZALLET_RPC_USER=... ZALLET_RPC_PASSWORD=... ESCROW_ACCOUNT=0 npm run start
 */
import { join } from "node:path";
import { Coordinator } from "./coordinator/coordinator.js";
import { buildServer } from "./coordinator/server.js";
import { JsonRpc, Ledger, RpcEscrowAddresses, WalletRpcSpender, ZcashRpcChain } from "./chain/zcashRpc.js";
import { SignerNode } from "./signer/signerNode.js";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing ${k}. See .env.example.`);
  return v;
};

const network = process.env.SOD_NETWORK ?? "testnet";
if (network !== "testnet" && network !== "regtest") {
  // Single-key escrow means the operator holds the money. It is for testnet and regtest only.
  throw new Error(`Refusing to run single-key mode on "${network}". Use testnet or regtest.`);
}

const dataDir = process.env.SOD_DATA_DIR ?? "./data";
const auth = process.env.ZALLET_RPC_USER
  ? { user: process.env.ZALLET_RPC_USER, password: process.env.ZALLET_RPC_PASSWORD ?? "" }
  : undefined;
const nodeAuth = process.env.ZEBRA_RPC_USER
  ? { user: process.env.ZEBRA_RPC_USER, password: process.env.ZEBRA_RPC_PASSWORD ?? "" }
  : undefined;

const node = new JsonRpc(need("ZEBRA_RPC_URL"), nodeAuth);
const wallet = new JsonRpc(need("ZALLET_RPC_URL"), auth);
const ledger = new Ledger(join(dataDir, "ledger.json"));
const chain = new ZcashRpcChain(node, wallet, ledger);
const escrow = new RpcEscrowAddresses(wallet, ledger, Number(process.env.ESCROW_ACCOUNT ?? 0));
const signers = [new SignerNode(1, chain, "single-key")];

const coord = new Coordinator({
  chain,
  signers,
  spender: new WalletRpcSpender(signers, 1, chain, wallet, { privacyPolicy: process.env.SOD_PRIVACY_POLICY }),
  escrow,
  revealTotals: (process.env.SOD_REVEAL_TOTALS as "live" | "after-deadline") ?? "after-deadline",
  dataDir,
});

await coord.init();
const port = Number(process.env.PORT ?? 8787);
buildServer(coord, network).listen(port, () => console.log(`Sod (${network}, single-key) on http://localhost:${port}`));

/**
 * Demo server: in-memory fake Zcash network, 5 signers, 3-of-5 quorum.
 * Lets the frontend run end to end with no node, no wallet and no testnet funds.
 *
 *   npm run dev            -> http://localhost:8787
 *   POST /dev/donate       {campaignId, valueZat, commitment}   simulate a donor's shielded payment
 *   POST /dev/advance      {seconds}                            move the fake chain clock forward
 *   POST /dev/advance-to   {unix}                               jump the fake chain clock to a time
 */
import { MockChain } from "./chain/mockChain.js";
import { Coordinator, MockEscrowAddresses } from "./coordinator/coordinator.js";
import { buildServer, type Extra } from "./coordinator/server.js";
import { encodeMemo } from "./core/memo.js";
import { SignerNode } from "./signer/signerNode.js";
import { MockThresholdSpender } from "./threshold/spender.js";

const chain = new MockChain(Math.floor(Date.now() / 1000));
const signers = Array.from({ length: 5 }, (_, i) => new SignerNode(i + 1, chain, `demo-share-key-${i + 1}`));
const coord = new Coordinator({
  chain,
  signers,
  spender: new MockThresholdSpender(signers, 3, chain),
  escrow: new MockEscrowAddresses(),
  revealTotals: (process.env.SOD_REVEAL_TOTALS as "live" | "after-deadline") ?? "after-deadline",
});

const extra: Extra = async (req, res, path) => {
  if (req.method !== "POST" || !path.startsWith("/dev/")) return false;
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const b = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  const out = (o: unknown) => {
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify(o));
  };
  if (path === "/dev/donate") {
    const id = chain.donate(String(b.campaignId), BigInt(b.valueZat), encodeMemo(String(b.commitment)));
    chain.mine(3); // confirmations
    out({ noteId: id });
    return true;
  }
  if (path === "/dev/advance") {
    chain.advance(Number(b.seconds));
    out({ time: chain.time });
    return true;
  }
  if (path === "/dev/advance-to") {
    chain.advanceTo(Number(b.unix));
    out({ time: chain.time });
    return true;
  }
  return false;
};

const port = Number(process.env.PORT ?? 8787);
buildServer(coord, "mock", extra).listen(port, () => console.log(`Sod (mock Zcash) on http://localhost:${port}`));

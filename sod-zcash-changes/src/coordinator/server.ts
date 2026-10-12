import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Coordinator } from "./coordinator.js";
import { MIN_CONFIRMATIONS, SETTLE_DELAY_SEC } from "../core/policy.js";

const MAX_BODY = 32 * 1024;

function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(body));
}

export type Extra = (req: IncomingMessage, res: ServerResponse, path: string) => Promise<boolean>;

/** Thin JSON API over the Coordinator. `extra` lets the demo add simulator routes. */
export function buildServer(coord: Coordinator, network: string, extra?: Extra): Server {
  return createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") return send(res, 204, {});
      const path = new URL(req.url ?? "/", "http://x").pathname;

      if (extra && (await extra(req, res, path))) return;

      if (req.method === "GET" && path === "/api/config")
        return send(res, 200, { network, minConfirmations: MIN_CONFIRMATIONS, settleDelaySec: SETTLE_DELAY_SEC });

      if (req.method === "GET" && path === "/api/campaigns") return send(res, 200, await coord.list());

      const dm = /^\/api\/campaigns\/([0-9a-f]{64})\/donations\/([0-9a-f]{64})$/.exec(path);
      if (req.method === "GET" && dm) {
        const d = await coord.donation(dm[1]!, dm[2]!);
        if (!d) return send(res, 404, { error: "UnknownCampaign" });
        return send(res, 200, d.status === "unknown" ? d : { status: d.status, valueZat: d.valueZat.toString() });
      }

      const m = /^\/api\/campaigns\/([0-9a-f]{64})(?:\/(refund|withdraw))?$/.exec(path);
      if (m) {
        const id = m[1]!;
        if (req.method === "GET" && !m[2]) {
          if (!coord.has(id)) return send(res, 404, { error: "UnknownCampaign" });
          return send(res, 200, await coord.view(id));
        }
        if (req.method === "POST" && m[2] === "refund") {
          const b = await readJson(req);
          const out = await coord.refund({ campaignId: id, secret: String(b.secret ?? ""), refundTo: String(b.refundTo ?? "") });
          return send(res, out.ok ? 200 : 409, out);
        }
        if (req.method === "POST" && m[2] === "withdraw") {
          const out = await coord.withdraw({ campaignId: id });
          return send(res, out.ok ? 200 : 409, out);
        }
      }

      if (req.method === "POST" && path === "/api/campaigns") {
        const b = await readJson(req);
        let goal: bigint;
        try {
          goal = BigInt(String(b.goalZat));
        } catch {
          return send(res, 400, { error: "goalZat must be an integer string" });
        }
        const out = await coord.createCampaign({
          name: String(b.name ?? ""),
          description: String(b.description ?? ""),
          imageURI: String(b.imageURI ?? ""),
          goalZat: goal,
          deadline: Number(b.deadline),
          creatorAddress: String(b.creatorAddress ?? ""),
          nonce: String(b.nonce ?? ""),
        });
        return send(res, out.ok ? 201 : 400, out.ok ? out.view : { error: out.error });
      }

      send(res, 404, { error: "not found" });
    } catch (e) {
      send(res, 400, { error: (e as Error).message });
    }
  });
}

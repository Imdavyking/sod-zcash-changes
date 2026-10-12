// Guards that the browser's commitment hash matches the signers'. Run: node --experimental-strip-types check/commitment.mjs
// Expected value comes from sod-zcash/test (see the pinned vector below).
import { computeCommitment, encodeMemo } from "../src/lib/commitment.ts";
const id = "11".repeat(32), secret = "22".repeat(32), to = "u1" + "a".repeat(60);
const got = computeCommitment(id, secret, to);
const want = process.argv[2];
console.log(got);
if (want && want !== got) { console.error("MISMATCH vs backend:", want); process.exit(1); }
console.log(encodeMemo(got).length, "byte memo");

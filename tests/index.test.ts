import { describe, test, expect, beforeAll } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let AuctionEngine: any;
let ResourceType: any;
let engine: any;
let dir: string;

beforeAll(async () => {
  // The engine persists state to ./data relative to the process cwd, so run
  // the whole suite against a throwaway directory.
  dir = mkdtempSync(join(tmpdir(), "resource-auction-"));
  process.chdir(dir);
  ({ AuctionEngine, ResourceType } = await import("../src/index"));
  engine = new AuctionEngine();
});

describe("AuctionEngine", () => {
  test("boots with the initial resource catalog", () => {
    const resources = engine.getResources();
    expect(resources.length).toBe(3);
    expect(resources.map((r: any) => r.type)).toContain(ResourceType.COMPUTE_H100);
    expect(engine.getStatus().resources).toBe(3);
  });

  test("registerAgent creates a wallet with the given balance", () => {
    const w = engine.registerAgent("agent-alpha", 2000);
    expect(w.agentId).toBe("agent-alpha");
    expect(w.balance).toBe(2000);
    expect(w.locked).toBe(0);
    expect(engine.getWallet("agent-alpha").balance).toBe(2000);
  });

  test("placeBid locks funds, enforces min bid, and tracks the high bid", () => {
    engine.registerAgent("agent-beta", 2000);
    const auction = engine.createAuction("res-001", 5);
    expect(auction.status).toBe("active");

    expect(() => engine.placeBid("agent-alpha", auction.id, 10)).toThrow(); // below min bid (100)
    engine.placeBid("agent-alpha", auction.id, 150);
    expect(engine.getWallet("agent-alpha").locked).toBe(150);

    engine.placeBid("agent-beta", auction.id, 200);
    expect(engine.getWallet("agent-alpha").locked).toBe(0); // refunded on outbid
    expect(engine.getWallet("agent-beta").locked).toBe(200);

    const active = engine.getAuctions("active").find((a: any) => a.id === auction.id);
    expect(active.bids.length).toBe(2);
    expect(active.bids[active.bids.length - 1].amount).toBe(200);
  });

  test("finalizeAuction settles funds and closes the auction", () => {
    engine.registerAgent("agent-gamma", 1000);
    const auction = engine.createAuction("res-002", 5);
    engine.placeBid("agent-gamma", auction.id, 60);

    const finalized = engine.finalizeAuction(auction.id);
    expect(finalized.status).toBe("completed");
    expect(finalized.winner.agentId).toBe("agent-gamma");
    expect(finalized.winner.amount).toBe(60);
    // winner pays: locked funds consumed, not refunded
    const wallet = engine.getWallet("agent-gamma");
    expect(wallet.locked).toBe(0);
    expect(wallet.balance).toBe(940);
  });

  test("finalizeAuction with no bids completes with no winner", () => {
    engine.registerAgent("agent-delta", 1000);
    const auction = engine.createAuction("res-003", 5);
    const finalized = engine.finalizeAuction(auction.id);
    expect(finalized.status).toBe("completed");
    expect(finalized.winner).toBeUndefined();
    expect(finalized.winner).toBeUndefined();
  });

  test("placeBid on an unknown auction throws", () => {
    expect(() => engine.placeBid("agent-alpha", "no-such-auction", 500)).toThrow();
  });
});

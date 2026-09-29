#!/usr/bin/env bun
/**
 * agent-resource-auction - Decentralized bidding system for agents
 * Built by Retsumdk
 * 
 * This tool allows AI agents to bid for prioritized compute resources,
 * exclusive tool access, and higher API rate limits during peak demand.
 */

import { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";

// --- Types & Interfaces ---

export enum ResourceType {
  COMPUTE_H100 = "compute-h100",
  COMPUTE_L40S = "compute-l40s",
  API_PREMIUM_TIER = "api-premium-tier",
  MEMORY_VECTOR_EXT = "memory-vector-ext",
  EXCLUSIVE_TOOL_ACCESS = "exclusive-tool-access",
}

export interface Resource {
  id: string;
  type: ResourceType;
  capacity: number;
  unit: string;
  minBid: number;
}

export interface Bid {
  id: string;
  agentId: string;
  auctionId: string;
  amount: number;
  timestamp: number;
}

export interface Auction {
  id: string;
  resourceId: string;
  startTime: number;
  endTime: number;
  status: "active" | "completed" | "cancelled";
  bids: Bid[];
  winner?: {
    agentId: string;
    amount: number;
  };
}

export interface AgentWallet {
  agentId: string;
  balance: number;
  locked: number;
}

export interface SystemState {
  resources: Resource[];
  auctions: Auction[];
  wallets: Record<string, AgentWallet>;
  lastUpdate: number;
}

// --- Constants & Defaults ---

const DATA_DIR = join(process.cwd(), "data");
const STATE_FILE = join(DATA_DIR, "state.json");

const INITIAL_RESOURCES: Resource[] = [
  { id: "res-001", type: ResourceType.COMPUTE_H100, capacity: 8, unit: "nodes", minBid: 100 },
  { id: "res-002", type: ResourceType.API_PREMIUM_TIER, capacity: 5000, unit: "rpm", minBid: 50 },
  { id: "res-003", type: ResourceType.EXCLUSIVE_TOOL_ACCESS, capacity: 1, unit: "slot", minBid: 250 },
];

// --- Core Engine ---

export class AuctionEngine {
  private state: SystemState;

  constructor() {
    this.state = this.loadState();
  }

  private loadState(): SystemState {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    
    if (existsSync(STATE_FILE)) {
      try {
        const data = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
        return data;
      } catch (e) {
        console.error("Failed to load state, using defaults");
      }
    }

    const newState: SystemState = {
      resources: INITIAL_RESOURCES,
      auctions: [],
      wallets: {},
      lastUpdate: Date.now(),
    };
    this.saveState(newState);
    return newState;
  }

  private saveState(state: SystemState = this.state): void {
    state.lastUpdate = Date.now();
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }

  public getStatus() {
    return {
      activeAuctions: this.state.auctions.filter(a => a.status === "active").length,
      totalAgents: Object.keys(this.state.wallets).length,
      resources: this.state.resources.length,
    };
  }

  public registerAgent(agentId: string, initialBalance: number = 1000): AgentWallet {
    if (this.state.wallets[agentId]) return this.state.wallets[agentId];

    const wallet: AgentWallet = {
      agentId,
      balance: initialBalance,
      locked: 0,
    };
    this.state.wallets[agentId] = wallet;
    this.saveState();
    return wallet;
  }

  public createAuction(resourceId: string, durationMinutes: number): Auction {
    const resource = this.state.resources.find(r => r.id === resourceId);
    if (!resource) throw new Error(`Resource ${resourceId} not found`);

    const auction: Auction = {
      id: `auc-${uuidv4().slice(0, 8)}`,
      resourceId,
      startTime: Date.now(),
      endTime: Date.now() + durationMinutes * 60000,
      status: "active",
      bids: [],
    };

    this.state.auctions.push(auction);
    this.saveState();
    return auction;
  }

  public placeBid(agentId: string, auctionId: string, amount: number): Bid {
    const auction = this.state.auctions.find(a => a.id === auctionId);
    if (!auction) throw new Error(`Auction ${auctionId} not found`);
    if (auction.status !== "active") throw new Error("Auction is not active");
    
    const now = Date.now();
    if (now > auction.endTime) {
      this.finalizeAuction(auction.id);
      throw new Error("Auction has already ended");
    }

    const wallet = this.state.wallets[agentId];
    if (!wallet) throw new Error(`Agent ${agentId} not registered`);

    const currentHighestBid = auction.bids.length > 0 
      ? [...auction.bids].sort((a, b) => b.amount - a.amount)[0]
      : null;

    const resource = this.state.resources.find(r => r.id === auction.resourceId);
    if (!resource) throw new Error("Resource consistency error");

    if (currentHighestBid && amount <= currentHighestBid.amount) {
      throw new Error(`Bid must be higher than current highest bid (${currentHighestBid.amount})`);
    }
    if (amount < resource.minBid) throw new Error(`Bid must be at least the minimum bid (${resource.minBid})`);
    
    // Check balance (including previously locked bids for THIS auction)
    const previousBid = auction.bids.find(b => b.agentId === agentId);
    const additionalNeeded = amount - (previousBid ? previousBid.amount : 0);
    
    if (wallet.balance < additionalNeeded) {
      throw new Error(`Insufficient balance. Needed ${additionalNeeded}, Available ${wallet.balance}`);
    }

    // Refund previous highest bidder if it's not the same agent
    if (currentHighestBid && currentHighestBid.agentId !== agentId) {
      const prevWinnerWallet = this.state.wallets[currentHighestBid.agentId];
      if (prevWinnerWallet) {
        prevWinnerWallet.locked -= currentHighestBid.amount;
        prevWinnerWallet.balance += currentHighestBid.amount;
        console.log(`[Auction] Refunded ${currentHighestBid.amount} to Agent ${currentHighestBid.agentId} (outbid)`);
      }
    }

    // Lock funds for new bid
    wallet.balance -= additionalNeeded;
    wallet.locked += additionalNeeded;

    const bid: Bid = {
      id: `bid-${uuidv4().slice(0, 8)}`,
      agentId,
      auctionId,
      amount,
      timestamp: Date.now(),
    };

    auction.bids.push(bid);
    this.saveState();
    return bid;
  }

  public finalizeAuction(auctionId: string): Auction {
    const auction = this.state.auctions.find(a => a.id === auctionId);
    if (!auction) throw new Error(`Auction ${auctionId} not found`);
    if (auction.status !== "active") return auction;

    auction.status = "completed";
    
    if (auction.bids.length > 0) {
      const highestBid = [...auction.bids].sort((a, b) => b.amount - a.amount)[0];
      auction.winner = {
        agentId: highestBid.agentId,
        amount: highestBid.amount,
      };

      // Process wallet updates
      for (const agentId in this.state.wallets) {
        const wallet = this.state.wallets[agentId];
        const agentBidsInAuction = auction.bids.filter(b => b.agentId === agentId);
        
        if (agentBidsInAuction.length > 0) {
          const totalAgentLocked = Math.max(...agentBidsInAuction.map(b => b.amount));
          
          if (agentId === highestBid.agentId) {
            // Winner pays: locked funds are removed
            wallet.locked -= totalAgentLocked;
            console.log(`Agent ${agentId} won auction ${auctionId} for ${totalAgentLocked}`);
          } else {
            // Losers get refund: locked funds return to balance
            wallet.locked -= totalAgentLocked;
            wallet.balance += totalAgentLocked;
          }
        }
      }
    }

    this.saveState();
    return auction;
  }

  public maintenance() {
    const now = Date.now();
    let updated = false;
    for (const auction of this.state.auctions) {
      if (auction.status === "active" && now > auction.endTime) {
        this.finalizeAuction(auction.id);
        updated = true;
      }
    }
    if (updated) this.saveState();
  }

  public getAuctions(status?: "active" | "completed") {
    this.maintenance();
    return status ? this.state.auctions.filter(a => a.status === status) : this.state.auctions;
  }

  public getWallet(agentId: string) {
    return this.state.wallets[agentId];
  }

  public getResources() {
    return this.state.resources;
  }
}

// --- CLI Interface ---

export const engine = new AuctionEngine();
const program = new Command();

program
  .name("agent-resource-auction")
  .description("Decentralized bidding system for AI agent resources")
  .version("1.0.0");

program.command("status")
  .description("Show system status")
  .action(() => {
    const status = engine.getStatus();
    console.log("\n--- System Status ---");
    console.log(`Active Auctions: ${status.activeAuctions}`);
    console.log(`Registered Agents: ${status.totalAgents}`);
    console.log(`Resources Managed: ${status.resources}`);
  });

program.command("list-resources")
  .description("List available resource types")
  .action(() => {
    const resources = engine.getResources();
    console.log("\n--- Available Resources ---");
    console.table(resources.map(r => ({
      ID: r.id,
      Type: r.type,
      Capacity: `${r.capacity} ${r.unit}`,
      "Min Bid": r.minBid
    })));
  });

program.command("list-auctions")
  .description("List current auctions")
  .option("-a, --active", "Show only active auctions")
  .action((options) => {
    const auctions = engine.getAuctions(options.active ? "active" : undefined);
    console.log(`\n--- Auctions (${options.active ? "Active" : "All"}) ---`);
    if (auctions.length === 0) {
      console.log("No auctions found.");
      return;
    }
    console.table(auctions.map(a => ({
      ID: a.id,
      Resource: a.resourceId,
      Status: a.status,
      Bids: a.bids.length,
      "Highest Bid": a.bids.length > 0 ? Math.max(...a.bids.map(b => b.amount)) : "N/A",
      "Ends In": a.status === "active" ? `${Math.round((a.endTime - Date.now()) / 60000)}m` : "Ended"
    })));
  });

program.command("register")
  .description("Register an agent")
  .argument("<agentId>", "Agent ID")
  .option("-b, --balance <amount>", "Initial balance", "1000")
  .action((agentId, options) => {
    try {
      const wallet = engine.registerAgent(agentId, parseFloat(options.balance));
      console.log(`✓ Agent ${agentId} registered. Balance: ${wallet.balance}`);
    } catch (e) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

program.command("wallet")
  .description("Check agent wallet")
  .argument("<agentId>", "Agent ID")
  .action((agentId) => {
    const wallet = engine.getWallet(agentId);
    if (!wallet) {
      console.error(`Agent ${agentId} not found. Use 'register' first.`);
      return;
    }
    console.log(`\n--- Wallet: ${agentId} ---`);
    console.log(`Available Balance: ${wallet.balance}`);
    console.log(`Locked (In Bids): ${wallet.locked}`);
    console.log(`Total Value: ${wallet.balance + wallet.locked}`);
  });

program.command("create-auction")
  .description("Start a new auction (Admin)")
  .argument("<resourceId>", "Resource ID")
  .option("-d, --duration <minutes>", "Duration in minutes", "60")
  .action((resourceId, options) => {
    try {
      const auction = engine.createAuction(resourceId, parseInt(options.duration));
      console.log(`✓ Auction created: ${auction.id}`);
      console.log(`Resource: ${resourceId} | Duration: ${options.duration}m`);
    } catch (e) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

program.command("bid")
  .description("Place a bid on an auction")
  .argument("<agentId>", "Agent ID")
  .argument("<auctionId>", "Auction ID")
  .argument("<amount>", "Bid amount")
  .action((agentId, auctionId, amount) => {
    try {
      const bid = engine.placeBid(agentId, auctionId, parseFloat(amount));
      console.log(`✓ Bid placed successfully!`);
      console.log(`Bid ID: ${bid.id} | Amount: ${bid.amount}`);
    } catch (e) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

program.command("history")
  .description("View completed auctions and winners")
  .action(() => {
    const auctions = engine.getAuctions("completed");
    console.log("\n--- Auction History ---");
    if (auctions.length === 0) {
      console.log("No completed auctions yet.");
      return;
    }
    console.table(auctions.map(a => ({
      ID: a.id,
      Resource: a.resourceId,
      Winner: a.winner ? a.winner.agentId : "None",
      Amount: a.winner ? a.winner.amount : 0,
      "Total Bids": a.bids.length,
      Ended: new Date(a.endTime).toLocaleString()
    })));
  });

program.command("demo")
  .description("Run a quick simulation demo")
  .action(async () => {
    console.log("Starting demo simulation...");
    const agentA = "agent-alpha";
    const agentB = "agent-beta";
    
    engine.registerAgent(agentA, 2000);
    engine.registerAgent(agentB, 2000);
    
    const auction = engine.createAuction("res-001", 1); // 1 minute
    console.log(`Created auction ${auction.id} for ${ResourceType.COMPUTE_H100}`);
    
    engine.placeBid(agentA, auction.id, 150);
    console.log(`Agent Alpha bid 150`);
    
    engine.placeBid(agentB, auction.id, 200);
    console.log(`Agent Beta bid 200`);
    
    engine.placeBid(agentA, auction.id, 300);
    console.log(`Agent Alpha outbid with 300`);
    
    console.log("\nCurrent Standings:");
    console.table([engine.getWallet(agentA), engine.getWallet(agentB)]);
    
    console.log("\nDemo complete. Use 'list-auctions' to see state.");
  });

if (import.meta.main) {
  program.parse();
}

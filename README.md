# agent-resource-auction

Decentralized bidding system for agents to acquire prioritized compute resources and exclusive tool access during peak demand.

## Features

- **Auction Engine**: Robust bidding logic with real-time outbid detection and automatic fund locking.
- **Resource Management**: Manage prioritized compute nodes (H100/L40S), premium API tiers, and exclusive tool slots.
- **Escrow-style Wallets**: Integrated wallet system with fund locking to ensure bid validity and prevent double-spending.
- **CLI Interface**: Complete command-line interface for human and agent interaction.
- **Simulation Demo**: Built-in demo to visualize multi-agent bidding wars.

## Installation

```bash
git clone https://github.com/Retsumdk/agent-resource-auction.git
cd agent-resource-auction
bun install
```

## Usage

### System Status
```bash
bun src/index.ts status
```

### Resource Discovery
```bash
bun src/index.ts list-resources
```

### Bidding
```bash
# Register your agent
bun src/index.ts register agent-007

# Place a bid
bun src/index.ts bid agent-007 auc-12345 500
```

### Admin: Create Auction
```bash
bun src/index.ts create-auction res-001 --duration 30
```

## Configuration

State is persisted in `data/state.json`.

## License

MIT License

---

Built by [Retsumdk](https://github.com/Retsumdk)

# GovNet

A blockchain-powered governance and voting platform that enables communities, organizations, and municipalities to propose, vote, and execute decisions transparently — all on-chain.

---

## Overview

GovNet consists of ten main smart contracts that together form a decentralized, verifiable, and automated governance ecosystem:

1. **Governance Token Contract** – Issues and manages tokens representing voting rights.
2. **Proposal Factory Contract** – Creates and manages governance proposals.
3. **Voting Contract** – Handles multiple voting models including quadratic and ranked-choice.
4. **Delegation Contract** – Allows token holders to delegate voting power.
5. **Identity Registry Contract** – Manages decentralized identity (DID) and KYC verification for voters.
6. **Treasury Contract** – Holds and allocates funds based on approved proposals.
7. **Execution Engine Contract** – Automates proposal implementation once approved.
8. **Dispute Resolution Contract** – Facilitates challenges and arbitration of results.
9. **Reputation System Contract** – Tracks and rewards active governance participants.
10. **Audit Log Contract** – Permanently records all governance actions for transparency.

---

## Features

- **Token-based governance** with flexible voting models  
- **Proposal creation** with automated execution  
- **Voting delegation** for representative decision-making  
- **Identity verification** to ensure eligibility and prevent fraud  
- **On-chain treasury management** tied to voting outcomes  
- **Built-in dispute resolution** for fairness  
- **Reputation tracking** to reward active participants  
- **Immutable audit trail** for full transparency  

---

## Smart Contracts

### Governance Token Contract
- Mint, burn, and transfer governance tokens
- Staking for voting power
- Supply control mechanisms

### Proposal Factory Contract
- Create and manage proposals
- Set proposal metadata and deadlines
- Interface with Voting and Execution Engine contracts

### Voting Contract
- Token-weighted, quadratic, and ranked-choice voting
- Quorum and voting period enforcement
- Result calculation and on-chain storage

### Delegation Contract
- Delegate and revoke voting rights
- Track delegation chains
- Prevent circular delegation

### Identity Registry Contract
- Integrates with DIDs or off-chain KYC providers
- Verifies voter eligibility
- Prevents duplicate identities

### Treasury Contract
- Holds community funds
- Allocates funds automatically based on vote outcomes
- Tracks deposits and withdrawals

### Execution Engine Contract
- Automates proposal outcomes
- Executes fund transfers, parameter changes, or contract upgrades
- Works with Treasury and Proposal contracts

### Dispute Resolution Contract
- Initiate challenges to vote outcomes
- Assign arbitrators or jury-based resolution
- Execute dispute outcomes on-chain

### Reputation System Contract
- Tracks participation history
- Assigns reputation scores
- Rewards active voters with incentives

### Audit Log Contract
- Stores all proposals, votes, and actions permanently
- Publicly queryable
- Tamper-proof historical record

---

## Installation

1. Install [Clarinet CLI](https://docs.hiro.so/clarinet/getting-started)
2. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/govnet.git
   ```
3. Run tests:
    ```bash
    npm test
    ```
4. Deploy contracts:
    ```bash
    clarinet deploy
    ```

---

## Usage

Each smart contract operates independently but integrates with others for a complete governance workflow.
Refer to individual contract documentation for function calls, parameters, and usage examples.

---

## License

MIT License
import { describe, it, expect, beforeEach } from "vitest";

/**
 * Strongly-typed mock of the Clarity GovNet token contract state/logic.
 * Simulates balances, staking, delegation (with proper cycle detection), reputation, and voting power.
 */

type Principal = string;

interface State {
  admin: Principal;
  paused: boolean;
  totalSupply: bigint;
  balances: Map<Principal, bigint>;
  staked: Map<Principal, bigint>;
  delegation: Map<Principal, Principal>; // delegator -> delegatee
  incomingDelegated: Map<Principal, bigint>; // delegatee -> delegated quadratic power
  reputation: Map<Principal, bigint>;
  proposalsVoted: Map<Principal, bigint>;
  MAX_SUPPLY: bigint;
}

const ERR = {
  NOT_AUTHORIZED: 100,
  INSUFFICIENT_BALANCE: 101,
  INSUFFICIENT_STAKE: 102,
  SELF_DELEGATION: 103,
  DELEGATION_CYCLE: 104,
  ALREADY_DELEGATED: 105,
  NOT_DELEGATED: 106,
  PAUSED: 107,
  ZERO_ADDRESS: 108,
};

const sqrtBigInt = (value: bigint): bigint => {
  if (value < 2n) return value;
  let x0 = value;
  let x1 = (value + 1n) >> 1n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x1 + value / x1) >> 1n;
  }
  return x0;
};

class MockGovNet {
  state: State;

  constructor(admin: Principal) {
    this.state = {
      admin,
      paused: false,
      totalSupply: 0n,
      balances: new Map(),
      staked: new Map(),
      delegation: new Map(),
      incomingDelegated: new Map(),
      reputation: new Map(),
      proposalsVoted: new Map(),
      MAX_SUPPLY: 1_000_000_000n,
    };
  }

  isAdmin(caller: Principal) {
    return caller === this.state.admin;
  }

  setPaused(caller: Principal, p: boolean) {
    if (!this.isAdmin(caller)) return { error: ERR.NOT_AUTHORIZED };
    this.state.paused = p;
    return { value: p };
  }

  mint(caller: Principal, recipient: Principal, amount: bigint) {
    if (!this.isAdmin(caller)) return { error: ERR.NOT_AUTHORIZED };
    if (this.state.totalSupply + amount > this.state.MAX_SUPPLY)
      return { error: ERR.INSUFFICIENT_BALANCE };
    const prev = this.state.balances.get(recipient) || 0n;
    this.state.balances.set(recipient, prev + amount);
    this.state.totalSupply += amount;
    return { value: true };
  }

  transfer(caller: Principal, recipient: Principal, amount: bigint) {
    if (this.state.paused) return { error: ERR.PAUSED };
    if (caller === recipient) return { value: true };
    const bal = this.state.balances.get(caller) || 0n;
    if (bal < amount) return { error: ERR.INSUFFICIENT_BALANCE };
    this.state.balances.set(caller, bal - amount);
    const dest = this.state.balances.get(recipient) || 0n;
    this.state.balances.set(recipient, dest + amount);
    return { value: true };
  }

  stake(caller: Principal, amount: bigint) {
    if (this.state.paused) return { error: ERR.PAUSED };
    const bal = this.state.balances.get(caller) || 0n;
    if (bal < amount) return { error: ERR.INSUFFICIENT_BALANCE };
    this.state.balances.set(caller, bal - amount);
    const prevStake = this.state.staked.get(caller) || 0n;
    this.state.staked.set(caller, prevStake + amount);
    return { value: true };
  }

  unstake(caller: Principal, amount: bigint) {
    if (this.state.paused) return { error: ERR.PAUSED };
    const stakeBal = this.state.staked.get(caller) || 0n;
    if (stakeBal < amount) return { error: ERR.INSUFFICIENT_STAKE };
    this.state.staked.set(caller, stakeBal - amount);
    const prevBal = this.state.balances.get(caller) || 0n;
    this.state.balances.set(caller, prevBal + amount);
    return { value: true };
  }

  computeVotingBase(account: Principal): bigint {
    const staked = this.state.staked.get(account) || 0n;
    const liquid = this.state.balances.get(account) || 0n;
    return staked + liquid;
  }

  computeQuadraticPower(account: Principal): bigint {
    const base = this.computeVotingBase(account);
    return sqrtBigInt(base);
  }

  effectiveVotingPower(account: Principal): bigint {
    const ownQuad = this.computeQuadraticPower(account);
    const incoming = this.state.incomingDelegated.get(account) || 0n;
    return ownQuad + incoming;
  }

  delegate(caller: Principal, to: Principal): { value?: true; error?: number } {
    if (this.state.paused) return { error: ERR.PAUSED };
    if (caller === to) return { error: ERR.SELF_DELEGATION };

    // detect cycle: does 'to' chain eventually lead to caller?
    let cursor: Principal | undefined = to;
    const visited = new Set<Principal>();
    while (cursor) {
      if (cursor === caller) {
        return { error: ERR.DELEGATION_CYCLE };
      }
      if (visited.has(cursor)) break;
      visited.add(cursor);
      const next = this.state.delegation.get(cursor);
      if (!next) break;
      cursor = next;
    }

    const existing = this.state.delegation.get(caller);
    const quadOfCaller = this.computeQuadraticPower(caller);
    if (existing) {
      if (existing === to) return { error: ERR.ALREADY_DELEGATED };
      // remove previous incoming tally
      const prevIncoming = this.state.incomingDelegated.get(existing) || 0n;
      this.state.incomingDelegated.set(
        existing,
        prevIncoming >= quadOfCaller ? prevIncoming - quadOfCaller : 0n
      );
    }

    // set new delegation
    this.state.delegation.set(caller, to);
    const prev = this.state.incomingDelegated.get(to) || 0n;
    this.state.incomingDelegated.set(to, prev + quadOfCaller);
    return { value: true };
  }

  revokeDelegation(caller: Principal) {
    if (this.state.paused) return { error: ERR.PAUSED };
    const existing = this.state.delegation.get(caller);
    if (!existing) return { error: ERR.NOT_DELEGATED };
    const quad = this.computeQuadraticPower(caller);
    const prevIncoming = this.state.incomingDelegated.get(existing) || 0n;
    this.state.incomingDelegated.set(
      existing,
      prevIncoming >= quad ? prevIncoming - quad : 0n
    );
    this.state.delegation.delete(caller);
    return { value: true };
  }

  recordVote(caller: Principal, proposalId: bigint) {
    if (this.state.paused) return { error: ERR.PAUSED };
    const prevVotes = this.state.proposalsVoted.get(caller) || 0n;
    this.state.proposalsVoted.set(caller, prevVotes + 1n);
    const prevRep = this.state.reputation.get(caller) || 0n;
    this.state.reputation.set(caller, prevRep + 1n);
    return { value: true };
  }

  getReputation(account: Principal): bigint {
    return this.state.reputation.get(account) || 0n;
  }
}

describe("GovNet Clarity Mock Contract", () => {
  let gov: MockGovNet;
  const ADMIN = "SPADMIN";
  const ALICE = "SPALICE";
  const BOB = "SPBOB";
  const CAROL = "SPCAROL";

  beforeEach(() => {
    gov = new MockGovNet(ADMIN);
    // seed balances
    expect(gov.mint(ADMIN, ALICE, 1_000n)).toEqual({ value: true });
    expect(gov.mint(ADMIN, BOB, 500n)).toEqual({ value: true });
    expect(gov.mint(ADMIN, CAROL, 100n)).toEqual({ value: true });
  });

  it("admin can pause and resume", () => {
    expect(gov.setPaused(ADMIN, true)).toEqual({ value: true });
    expect(gov.transfer(ALICE, BOB, 10n)).toEqual({ error: ERR.PAUSED });
    expect(gov.setPaused(ADMIN, false)).toEqual({ value: false });
    expect(gov.transfer(ALICE, BOB, 10n)).toEqual({ value: true });
  });

  it("should transfer tokens correctly", () => {
    expect(gov.transfer(ALICE, BOB, 200n)).toEqual({ value: true });
    expect(gov.computeVotingBase(ALICE)).toBe(800n);
    expect(gov.computeVotingBase(BOB)).toBe(700n);
  });

  it("should stake and adjust base voting power", () => {
    expect(gov.stake(ALICE, 400n)).toEqual({ value: true });
    // staking moves liquid to staked; base remains sum of both => 1000
    expect(gov.computeVotingBase(ALICE)).toBe(1_000n);
    const quad = gov.computeQuadraticPower(ALICE);
    expect(quad).toBe(sqrtBigInt(1_000n));
  });

  it("should delegate voting power and reflect effective power", () => {
    const aliceQuad = gov.computeQuadraticPower(ALICE);
    expect(aliceQuad).toBe(sqrtBigInt(1_000n));

    expect(gov.delegate(BOB, ALICE)).toEqual({ value: true });
    const bobQuad = gov.computeQuadraticPower(BOB);
    expect(bobQuad).toBe(sqrtBigInt(500n));

    const effectiveAlice = gov.effectiveVotingPower(ALICE);
    expect(effectiveAlice).toBe(aliceQuad + bobQuad);
  });

  it("should prevent delegation cycle", () => {
    expect(gov.delegate(BOB, ALICE)).toEqual({ value: true });
    // Alice tries to delegate to Bob -> would create a 2-cycle and must be rejected
    expect(gov.delegate(ALICE, BOB)).toEqual({ error: ERR.DELEGATION_CYCLE });
  });

  it("should revoke delegation and update incoming", () => {
    expect(gov.delegate(BOB, ALICE)).toEqual({ value: true });
    const before = gov.effectiveVotingPower(ALICE);
    expect(gov.revokeDelegation(BOB)).toEqual({ value: true });
    const after = gov.effectiveVotingPower(ALICE);
    expect(after).toBeLessThan(before);
  });

  it("should record votes and bump reputation", () => {
    expect(gov.getReputation(ALICE)).toBe(0n);
    expect(gov.recordVote(ALICE, 1n)).toEqual({ value: true });
    expect(gov.getReputation(ALICE)).toBe(1n);
    expect(gov.recordVote(ALICE, 2n)).toEqual({ value: true });
    expect(gov.getReputation(ALICE)).toBe(2n);
  });

  it("should combine delegation and staking correctly", () => {
    expect(gov.stake(ALICE, 500n)).toEqual({ value: true }); // Alice base stays 1000
    expect(gov.delegate(BOB, ALICE)).toEqual({ value: true });
    const aliceQuad = gov.computeQuadraticPower(ALICE);
    const bobQuad = gov.computeQuadraticPower(BOB);
    expect(gov.effectiveVotingPower(ALICE)).toBe(aliceQuad + bobQuad);
  });

  it("should not allow non-admin to mint", () => {
    expect(gov.mint(BOB, CAROL, 1000n)).toEqual({ error: ERR.NOT_AUTHORIZED });
  });

  it("should not allow over max supply mint", () => {
    const tooMuch = gov.state.MAX_SUPPLY + 1n;
    expect(gov.mint(ADMIN, ALICE, tooMuch)).toEqual({ error: ERR.INSUFFICIENT_BALANCE });
  });
});

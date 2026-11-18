# Hongbao.cash — line-by-line

One contract instance per envelope. The funding tx locks **N share UTXOs** to it (each optionally holding one immutable seal NFT). A share leaves the contract in one of two ways:

| Path | Who | When | Needs |
|---|---|---|---|
| `claim(linkSig, gateSig)` | the claimer's browser | any time (the gate refuses after expiry) | link secret **and** a gate approval for *this share → this recipient* |
| `refundBatch()` | anyone (our keeper) | after `expiry` | nothing; funds can only go to the sender |

Compiled: 194-byte script, 192 opcodes; 294 bytes with constructor args. Deployed as **P2SH32**, because P2S is capped at 201 bytes (see [docs/findings.md](../../../docs/findings.md) §1).

## Constructor

| Param | Meaning |
|---|---|
| `linkPk` | Public key of the link secret. The secret lives only in the share URL fragment `#k=…`, which browsers never send to servers |
| `gatePk` | Per-envelope gate key, derived server-side from `GATE_MASTER_SEED` |
| `refundLockingBytecode` | Sender's refund script (any locking bytecode, usually P2PKH) |
| `expiry` | Unix timestamp (≥ 500,000,000, so it's a time locktime, not a block height) |
| `maxFee` | Max sats a share may lose to network fee when spent (default 1,000) |

## `claim(sig linkSig, datasig gateSig)`

```solidity
require(tx.inputs.length == 1);
```
Exactly one share in. This blocks claiming several shares with one approval-and-signature pair (test #8). With a single input, `tx.inputs[0]` is always this share, so the code can use index 0. The outputs are checked further down: one or two, all to the approved recipient.

```solidity
require(checkSig(linkSig, linkPk));
```
Proves the spender holds the **link secret**. CashScript signs with `SIGHASH_ALL | SIGHASH_UTXOS`, so the signature commits to the whole transaction. The server never sees the secret, so the server alone can never claim (test #3).

```solidity
bytes recipient = tx.outputs[0].lockingBytecode;
bytes outpoint = tx.inputs[0].outpointTransactionHash + toPaddedBytes(tx.inputs[0].outpointIndex, 4);
require(checkDataSig(gateSig, recipient + outpoint, gatePk));
```
The **gate approval**. The gate signs `recipient ‖ outpoint` only after checking fairness rules (one claim per address, wallet and hold token; quiz answer; rate limits; envelope `ACTIVE`). Binding to:
- the **recipient** means a link holder can't redirect someone's approval to themselves (test #4);
- the **outpoint** means an approval for one share can't be replayed on another (test #5).

Byte details, which the API must reproduce exactly (use `gateMessage()` from this package):
- `outpointTransactionHash` is in **internal byte order**, the reverse of the txid explorers show;
- `toPaddedBytes(index, 4)` is **4-byte little-endian**;
- `checkDataSig` verifies a Schnorr signature over **`sha256(message)`** (`signGateApproval()`).

```solidity
require(tx.outputs[0].tokenCategory == tx.inputs[0].tokenCategory);
require(tx.outputs[0].nftCommitment == tx.inputs[0].nftCommitment);
require(tx.outputs[0].tokenAmount == tx.inputs[0].tokenAmount);
```
The seal NFT goes to the claimer **unchanged** on output 0 (test #9). Burning a token, changing a mutable NFT's commitment, or downgrading its capability are all *consensus-legal*, so only these lines prevent them. `tokenCategory` includes the capability byte, so capability changes fail the first line. For a BCH-only share, both sides are empty/0, which also forces output 0 to be token-less.

```solidity
int paid = tx.outputs[0].value;
if (tx.outputs.length == 2) {
    require(tx.outputs[1].lockingBytecode == recipient);
    require(tx.outputs[1].tokenCategory == 0x);
    paid = paid + tx.outputs[1].value;
} else {
    require(tx.outputs.length == 1);
}
```
An optional **second output pays plain BCH to the same recipient**. Wallets count only token-free outputs as BCH balance: on mainnet (2026-11-18), Paytaca showed the seal but not the sats riding on it. So a seal share puts the seal on a dust output (666 sats) and the rest on output 1 (test #7c). Output 1 can't go to anyone else (test #7) and can't carry a token (test #7d). With one input, the only token around is the share's seal, and output 0 must hold it. More than two outputs fail (test #7b).

```solidity
require(paid >= tx.inputs[0].value - maxFee);
```
The share pays its own network fee (that's why claimers need zero BCH), but at most `maxFee`. Everything else goes to the claimer, across both outputs (tests #6, #7e).

## `refundBatch()`

```solidity
require(tx.time >= expiry);
```
Compiles to `OP_CHECKLOCKTIMEVERIFY`. The tx must set `nLockTime >= expiry` and a non-final input sequence (CashScript's default `0xfffffffe`). Nodes only accept the tx once median-time-past ≥ locktime, so **nobody can refund early, not even the sender** (test #10).

```solidity
int inputCount = tx.inputs.length;
int outputCount = tx.outputs.length;
require(outputCount == inputCount || outputCount == inputCount + 1);
```
One refund output per share, so each seal stays on its own output (test #15), plus an optional **pooled BCH output** at index `inputCount` (test #17). The keeper uses it for seal envelopes: each seal goes back on a dust output, and the value comes back as plain BCH the sender's wallet counts. More than one extra output fails (test #19).

```solidity
bytes self = tx.inputs[this.activeInputIndex].lockingBytecode;
int i = 0;
do { … i = i + 1; } while (i < inputCount);
```
**Layla loop** (`OP_BEGIN … OP_UNTIL`). Every input runs this function and checks *every* input/output pair, which costs O(n²). A 20-share batch passes VM limits (test #12b), and the keeper caps batches at 20 (`MAX_REFUND_BATCH`).

Inside the loop:

```solidity
require(tx.inputs[i].lockingBytecode == self);
```
Every input is a share of **this** envelope. A UTXO from another contract can't be mixed in (test #14).

```solidity
require(tx.outputs[i].lockingBytecode == refundLockingBytecode);
```
Refunds can only go to the sender's script (test #13). This is why the keeper needs no keys: anyone may *trigger* a refund, but nobody can *redirect* it.

```solidity
require(tx.outputs[i].tokenCategory == tx.inputs[i].tokenCategory);
require(tx.outputs[i].nftCommitment == tx.inputs[i].nftCommitment);
require(tx.outputs[i].tokenAmount == tx.inputs[i].tokenAmount);
```
Seal *i* returns unchanged on output *i*. Swapping seals between outputs fails (test #15). The loop also sums `inSum` and `outSum`.

After the loop:

```solidity
if (outputCount > inputCount) {
    require(tx.outputs[inputCount].lockingBytecode == refundLockingBytecode);
    require(tx.outputs[inputCount].tokenCategory == 0x);
    outSum = outSum + tx.outputs[inputCount].value;
}
require(outSum >= inSum - maxFee * inputCount);
```
The pooled output also goes only to the sender (test #18) and carries no token. The fee cap is now on the whole tx: at most `maxFee` per share (tests #16, #20). Since every output pays the sender, how the value is spread across them doesn't matter.

## Honest limits (say these in the pitch)

- **Claims after expiry aren't blocked on-chain.** Script can only enforce "after", not "before". The gate refuses approvals after expiry, and the keeper refunds promptly.
- **The gate is a liveness dependency, not a custody risk.** If the server disappears, claims pause, but funds still go back to the sender after expiry.
- **A leaked approval is harmless.** It can only ever pay the address it was issued for.
- **Sybil resistance lives in the gate, not the script.** Someone with many wallets can collect one approval per wallet. Spec §8.2 covers the off-chain limits (per address, fingerprint, IP, quiz) and the farm flags.

## Test matrix

`pnpm --filter @hongbao/contract test` runs spec §5.4 on `MockNetworkProvider`, which validates every tx against the 2026 VM. Every ❌ case asserts *which* `require` failed, so a test can't pass for the wrong reason.

| # | Case | Result | Fails at |
|---|---|---|---|
| 1 | Valid claim, BCH-only | ✅ | |
| 2 | Valid claim with seal | ✅ | |
| 2b | Fee exactly `maxFee` | ✅ | |
| 3 | Wrong link key | ❌ | `checkSig(linkSig, linkPk)` |
| 4 / 4b | Approval for another recipient / not from gate key | ❌ | `checkDataSig` |
| 5 | Approval replayed on another share | ❌ | `checkDataSig` |
| 6 | Fee > `maxFee` | ❌ | `paid` check |
| 7 | 2nd output to someone else (skim) | ❌ | `tx.outputs[1].lockingBytecode == recipient` |
| 7b | 3 outputs | ❌ | `tx.outputs.length == 1` |
| 7c | Split claim: seal on output 0, BCH on output 1 | ✅ | |
| 7d | Seal moved to the BCH output | ❌ | token checks |
| 7e | Split claim with fee > `maxFee` | ❌ | `paid` check |
| 8 | 2 shares in one claim | ❌ | `tx.inputs.length == 1` |
| 9 | Drop seal / add token / change commitment / change capability | ❌ | token checks |
| 10 | Refund before expiry | ❌ | `tx.time >= expiry` |
| 11 | Refund 1 share | ✅ | |
| 12 / 12b | Refund 5 shares with seals / 20 shares | ✅ | |
| 13 | Refund to another address | ❌ | `refundLockingBytecode` check |
| 14 | Mix in another contract's input | ❌ | `lockingBytecode == self` |
| 15 | Fewer outputs / swapped seals | ❌ | output count / token checks |
| 16 | Refund fee > `maxFee` | ❌ | `outSum` check |
| 17 | Pooled refund: seals on dust outputs + one BCH output | ✅ | |
| 18 | Pooled output to another address | ❌ | `refundLockingBytecode` check |
| 19 | Two extra outputs | ❌ | output count |
| 20 | Pooled refund with fee > `maxFee` per share | ❌ | `outSum` check |

Recompile after editing: `pnpm --filter @hongbao/contract compile`. A test fails if the committed artifact is stale.

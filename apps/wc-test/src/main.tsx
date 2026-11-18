// Phase 2 go/no-go page (throwaway, not the product frontend).
// Question: can a real WizardConnect wallet (Paytaca / Cashonize) sign the Hongbao funding tx on
// Chipnet — including the CashTokens genesis (N seal NFTs to a P2SH32 contract + BCMR OP_RETURN)?
import { StrictMode, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useWizardConnect, WizardConnectQRDialog } from '@wizardconnect/react';
import type { DappConnectionManager } from '@wizardconnect/dapp';
import {
  ElectrumNetworkProvider,
  TransactionBuilder,
  placeholderP2PKHUnlocker,
  type Output,
  type SpendableUtxo,
} from 'cashscript';
import {
  binToHex,
  encodeCashAddress,
  encodeTransaction,
  generatePrivateKey,
  hash160,
  secp256k1,
  sha256,
} from '@bitauth/libauth';
import {
  DEFAULT_MAX_FEE,
  bcmrRegistryHash,
  equalSplit,
  fundingOutputs,
  hongbaoContract,
  shareOutputIndex,
} from '@hongbao/contract';

const EXPLORER = 'https://chipnet.imaginary.cash/tx/';
const PATHS = [
  { name: 'receive', child: 0, count: 20 },
  { name: 'change', child: 1, count: 10 },
] as const;
type PathName = (typeof PATHS)[number]['name'];

interface WalletAddr {
  path: PathName;
  index: number;
  lockingBytecode: Uint8Array;
  address: string;
  tokenAddress: string;
}
type WalletUtxo = SpendableUtxo & { addr: WalletAddr };

const provider = new ElectrumNetworkProvider('chipnet', { hostname: 'chipnet.imaginary.cash' });

function deriveAddresses(m: DappConnectionManager): WalletAddr[] {
  const out: WalletAddr[] = [];
  for (const p of PATHS) {
    if (!m.hasPath(p.child)) continue;
    for (let i = 0; i < p.count; i++) {
      const pub = m.getPubkey(p.child, BigInt(i));
      if (!pub) continue;
      const pkh = hash160(pub);
      out.push({
        path: p.name,
        index: i,
        lockingBytecode: Uint8Array.from([0x76, 0xa9, 0x14, ...pkh, 0x88, 0xac]),
        address: encodeCashAddress({ prefix: 'bchtest', type: 'p2pkh', payload: pkh }).address,
        tokenAddress: encodeCashAddress({ prefix: 'bchtest', type: 'p2pkhWithTokens', payload: pkh }).address,
      });
    }
  }
  return out;
}

type WcObj = ReturnType<TransactionBuilder['generateWcTransactionObject']>;

/** Relay-safe form of CashScript's WC object (mirrors @wizardconnect/core sourceOutputToRelay). */
function toRelayRequest(wc: WcObj) {
  return {
    transaction: binToHex(encodeTransaction(wc.transaction)),
    sourceOutputs: wc.sourceOutputs.map((so) => ({
      outpointTransactionHash: binToHex(so.outpointTransactionHash),
      outpointIndex: so.outpointIndex,
      unlockingBytecode: binToHex(so.unlockingBytecode),
      sequenceNumber: so.sequenceNumber,
      valueSatoshis: `<bigint: ${so.valueSatoshis}n>`,
      lockingBytecode: binToHex(so.lockingBytecode),
      ...(so.token && {
        token: {
          category: binToHex(so.token.category),
          amount: `<bigint: ${so.token.amount}n>`,
          ...(so.token.nft && {
            nft: { capability: so.token.nft.capability, commitment: binToHex(so.token.nft.commitment) },
          }),
        },
      }),
    })),
    broadcast: false,
    userPrompt: wc.userPrompt,
  };
}

/** Build → WC request object → wallet signs → broadcast. Change goes to receive/0. */
async function signAndSend(
  m: DappConnectionManager,
  inputs: WalletUtxo[],
  outputs: Output[],
  change: WalletAddr,
  prompt: string,
  log: (s: string) => void,
): Promise<string> {
  const make = (changeSats: bigint) => {
    const tb = new TransactionBuilder({ provider });
    for (const u of inputs) tb.addInput(u, placeholderP2PKHUnlocker(u.addr.address));
    tb.addOutputs(outputs).addOutput({ to: change.lockingBytecode, amount: changeSats });
    return tb.generateWcTransactionObject({ broadcast: false, userPrompt: prompt });
  };
  const inSum = inputs.reduce((s, u) => s + u.satoshis, 0n);
  const outSum = outputs.reduce((s, o) => s + o.amount, 0n);
  // Placeholder unlockers are empty: add ~107 B per P2PKH input for sig + pubkey.
  const size = encodeTransaction(make(inSum - outSum - 1_000n).transaction).length + 107 * inputs.length;
  const wcObj = make(inSum - outSum - BigInt(size));

  log(`Requesting signature (${inputs.length} inputs, ${outputs.length + 1} outputs, ~${size} B)… check your wallet`);
  const res = await m.signTransaction({
    // The relay sends JSON, which can't hold BigInt/Uint8Array. WizardConnect's convention
    // (core/protocols/hdwalletv1-serialize, not exported from the package index): transaction as
    // hex, source outputs with hex bytes and `<bigint: Xn>` strings.
    transaction: toRelayRequest(wcObj) as never,
    inputPaths: inputs.map((u, i) => [i, u.addr.path, u.addr.index]),
  });
  if (res.error) throw new Error(`wallet refused: ${res.error}`);
  log('Wallet signed ✅ — broadcasting');
  return provider.sendRawTransaction(res.signedTransaction);
}

function App() {
  const wc = useWizardConnect({ dappName: 'Hongbao Drops (WC test)' });
  const [addrs, setAddrs] = useState<WalletAddr[]>([]);
  const [utxos, setUtxos] = useState<WalletUtxo[]>([]);
  const [lines, setLines] = useState<string[]>([]);
  const [envelopeJson, setEnvelopeJson] = useState<string>();
  const [busy, setBusy] = useState(false);
  const log = useCallback((s: string) => setLines((l) => [...l, `${new Date().toLocaleTimeString()}  ${s}`]), []);

  const scan = useCallback(async () => {
    log('Scanning…');
    if (!wc.manager) {
      log('❌ No WizardConnect manager (state: ' + wc.state + '). Disconnect and connect again.');
      return;
    }
    const sessionPaths = wc.manager.getSessionPaths();
    log(`Session paths: ${JSON.stringify(sessionPaths.map((p) => p.name))}`);
    log(`hasPath child 0..7: ${[0, 1, 2, 3, 4, 5, 6, 7].map((c) => `${c}=${wc.manager!.hasPath(c)}`).join(' ')}`);
    const a = deriveAddresses(wc.manager);
    setAddrs(a);
    log(`Derived ${a.length} addresses; receive/0 = ${a.find((x) => x.path === 'receive' && x.index === 0)?.address ?? 'NONE'}`);
    const found: WalletUtxo[] = [];
    log(`Looking up ${a.length} addresses on Chipnet…`);
    const results = await Promise.all(
      a.map(async (addr) => ({ addr, utxos: await provider.getUtxos(addr.address) })),
    );
    for (const { addr, utxos: us } of results) {
      if (us.length) log(`  ${addr.path}/${addr.index} ${addr.address}: ${us.length} UTXOs`);
      for (const u of us) if (!u.token) found.push({ ...u, addr });
    }
    setUtxos(found);
    const paths = wc.manager.getSessionPaths();
    const receiveXpub = paths.find((p) => p.name === 'receive')?.xpub ?? '';
    log(`Paths from wallet: ${paths.map((p) => p.name).join(', ')}`);
    log(`Wallet fingerprint sha256(receive xpub): ${binToHex(sha256.hash(new TextEncoder().encode(receiveXpub))).slice(0, 16)}…`);
    log(`Found ${found.length} BCH UTXOs, ${found.reduce((s, u) => s + u.satoshis, 0n)} sats`);
  }, [wc.manager, log]);

  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      log(`❌ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const receive0 = addrs.find((a) => a.path === 'receive' && a.index === 0);
  const vout0 = utxos.find((u) => u.vout === 0 && u.satoshis >= 9_500n);

  const prep = run(async () => {
    const total = utxos.reduce((s, u) => s + u.satoshis, 0n);
    // One output only → it lands at vout 0, usable as the genesis input.
    const txid = await signAndSend(wc.manager!, utxos, [], receive0!, 'Hongbao: prepare (self-send)', log);
    log(`Prep tx (${total} sats consolidated): ${EXPLORER}${txid}`);
    await scan();
  });

  const fund = (withSeals: boolean) =>
    run(async () => {
      const input0 = withSeals ? vout0! : utxos[0]!;
      const seq = Math.floor(Date.now() / 1000) % 1_000_000;
      const linkPriv = generatePrivateKey();
      const gatePriv = generatePrivateKey();
      const expiry = Math.floor(Date.now() / 1000) + 20 * 60;
      const contract = hongbaoContract(
        {
          linkPk: secp256k1.derivePublicKeyCompressed(linkPriv) as Uint8Array,
          gatePk: secp256k1.derivePublicKeyCompressed(gatePriv) as Uint8Array,
          refundLockingBytecode: receive0!.lockingBytecode,
          expiry,
        },
        provider,
      );
      const shareAmounts = equalSplit(7_500n, 3);
      const category = input0.txid;
      const registry = JSON.stringify({ name: `Hongbao Seal #${seq}`, category });
      const outputs = fundingOutputs({
        contract,
        shareAmounts,
        ...(withSeals && {
          seals: {
            category,
            envelopeSeq: seq,
            identityLockingBytecode: receive0!.lockingBytecode, // test only; product → treasury
            bcmr: { registryHash: bcmrRegistryHash(new TextEncoder().encode(registry)), uris: [`hongbao.test/bcmr/${category}.json`] },
          },
        }),
      });
      const inputs = [input0, ...utxos.filter((u) => u !== input0)];
      const txid = await signAndSend(
        wc.manager!,
        inputs,
        outputs,
        receive0!,
        withSeals ? 'Hongbao: fund envelope (3 shares + 3 seals)' : 'Hongbao: fund envelope (3 shares)',
        log,
      );
      log(`Funding tx ${withSeals ? 'WITH seals (genesis)' : 'BCH-only'}: ${EXPLORER}${txid}`);
      // Same shape as scripts/.state/envelopes/<name>.json so the CLI can claim / refund it.
      setEnvelopeJson(
        JSON.stringify(
          {
            name: `wc-${seq}`,
            seq,
            createdAt: new Date().toISOString(),
            linkPrivHex: binToHex(linkPriv),
            gatePrivHex: binToHex(gatePriv),
            refundLockingBytecodeHex: binToHex(receive0!.lockingBytecode),
            expiry,
            maxFee: DEFAULT_MAX_FEE.toString(),
            withSeals,
            sealCategory: withSeals ? category : undefined,
            fundingTxid: txid,
            contractAddress: contract.tokenAddress,
            shares: shareAmounts.map((sats, i) => ({
              index: i + 1,
              txid,
              vout: shareOutputIndex(i, withSeals),
              sats: sats.toString(),
              commitment: outputs[shareOutputIndex(i, withSeals)]?.token?.nft?.commitment,
              status: 'AVAILABLE',
            })),
          },
          null,
          2,
        ),
      );
      await scan();
    });

  const total = utxos.reduce((s, u) => s + u.satoshis, 0n);
  return (
    <>
      <h1>🧧 Hongbao — WizardConnect test (Chipnet)</h1>
      <p>Connect a Chipnet wallet, then try signing the funding transactions below.</p>

      {wc.state !== 'connected' && (
        <button onClick={() => wc.connect()} disabled={wc.state === 'connecting'}>
          {wc.state === 'connecting' ? 'Waiting for wallet…' : 'Connect wallet'}
        </button>
      )}
      {wc.uri && wc.qrUri && (
        <WizardConnectQRDialog show={wc.state === 'connecting'} onClose={wc.disconnect} uri={wc.uri} qrUri={wc.qrUri} />
      )}
      {wc.error && <p style={{ color: 'crimson' }}>{wc.error}</p>}

      {wc.state === 'connected' && (
        <section>
          <p>
            Connected to <b>{wc.walletName}</b> · <button onClick={run(scan)} disabled={busy}>Scan addresses</button>{' '}
            <button onClick={wc.disconnect}>Disconnect</button>
          </p>
          {receive0 && (
            <p style={{ fontSize: 14 }}>
              receive/0: <code>{receive0.address}</code>
              <br />
              token-aware: <code>{receive0.tokenAddress}</code>
            </p>
          )}
          <p>Balance: {total.toString()} sats in {utxos.length} UTXOs (seal-bearing funding needs a vout-0 UTXO ≥ 9,500)</p>
          <ol>
            <li>
              <button onClick={fund(false)} disabled={busy || !receive0 || total < 10_000n}>
                Sign BCH-only funding (baseline)
              </button>
            </li>
            <li>
              <button onClick={prep} disabled={busy || !receive0 || utxos.length === 0 || !!vout0}>
                Sign prep tx (only if no vout-0 UTXO)
              </button>{' '}
              {vout0 ? '✓ vout-0 UTXO available' : 'no vout-0 UTXO ≥ 9,500 sats yet'}
            </li>
            <li>
              <button onClick={fund(true)} disabled={busy || !receive0 || !vout0}>
                Sign funding WITH seals (genesis + BCMR) ← the go/no-go
              </button>
            </li>
          </ol>
        </section>
      )}

      <pre style={{ background: '#111', color: '#ddd', padding: 12, whiteSpace: 'pre-wrap', fontSize: 12 }}>
        {lines.join('\n') || 'Log…'}
      </pre>
      {envelopeJson && (
        <details>
          <summary>Envelope state (save as scripts/.state/envelopes/&lt;name&gt;.json to claim/refund via CLI)</summary>
          <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>{envelopeJson}</pre>
        </details>
      )}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Phase 0 spike: compile a contract and report its size as P2SH32 vs P2S (201-byte P2S limit).
import { compileFile } from 'cashc';
import { Contract, MockNetworkProvider } from 'cashscript';
const file = process.argv[2];
const artifact = compileFile(new URL(file, import.meta.url));
const args = [
  new Uint8Array(33).fill(2), new Uint8Array(33).fill(3),
  Uint8Array.from([0x76, 0xa9, 0x14, ...new Array(20).fill(1), 0x88, 0xac]),
  1_800_000_000n, 2000n,
].slice(0, artifact.constructorInputs.length);
const types = artifact.constructorInputs.map((i) => i.type);
if (types[2] === "bytes20") { args[2] = new Uint8Array(20).fill(1); args.splice(3, 0); }
if (types.length === 4) args[3] = 1_800_000_000n;
const provider = new MockNetworkProvider();
for (const contractType of ['p2sh32', 'p2s']) {
  const c = new Contract(artifact, args, { provider, contractType });
  console.log(file, contractType, 'bytesize', c.bytesize, 'lockingBytecode', c.lockingBytecode.length ?? c.lockingBytecode);
}
console.log('opcount', artifact.bytecode.split(' ').length);

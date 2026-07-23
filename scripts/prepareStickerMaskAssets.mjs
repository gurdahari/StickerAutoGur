import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicModelDirectory = resolve(repositoryRoot, 'public/models');
const runtimeDirectory = resolve(publicModelDirectory, 'onnxruntime');
const nodeRuntimeDirectory = resolve(repositoryRoot, 'node_modules/onnxruntime-web/dist');
const modelPath = resolve(publicModelDirectory, 'u2netp.onnx');
const modelUrl = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx';
const modelSha256 = '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8';

const sha256 = async path =>
  createHash('sha256').update(await readFile(path)).digest('hex');

await mkdir(runtimeDirectory, { recursive: true });
await Promise.all([
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm'
].map(file => copyFile(resolve(nodeRuntimeDirectory, file), resolve(runtimeDirectory, file))));

let modelIsValid = false;
try {
  modelIsValid = await sha256(modelPath) === modelSha256;
} catch {
  // The first build downloads the pinned model below.
}

if (!modelIsValid) {
  const response = await fetch(modelUrl);
  if (!response.ok) throw new Error(`Could not download the pinned U2NETP model (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== modelSha256) {
    throw new Error(`U2NETP model checksum mismatch: expected ${modelSha256}, received ${digest}.`);
  }
  await writeFile(modelPath, bytes);
}

console.log('Local sticker mask assets are ready.');

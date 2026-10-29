import * as ort from '../vendor/ort/ort.wasm.min.mjs';
import { decodeCTC, selectConsensus } from './ocr-codec.js?v=5';
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = new URL('../vendor/ort/', import.meta.url).href;
ort.env.logLevel = 'error';
let session, dictionary;
async function recognizeVariant(line) {
  const input = new ort.Tensor('float32', line.data, [1, 3, 48, line.width]);
  let output;
  try {
    output = await session.run({ [session.inputNames[0]]: input });
    const tensor = output[session.outputNames[0]];
    return decodeCTC(tensor.data, tensor.dims, dictionary);
  } finally {
    input.dispose(); if (output) for (const tensor of Object.values(output)) tensor.dispose();
  }
}
self.onmessage = async ({ data: message }) => {
  try {
    if (message.type === 'init') {
      const root = new URL('../vendor/paddle-v6/', import.meta.url);
      const response = await fetch(new URL('dictionary.json', root));
      if (!response.ok) throw new Error('文字辞書を取得できませんでした。');
      dictionary = await response.json();
      session = await ort.InferenceSession.create(new URL('rec.onnx', root).href, { executionProviders: ['wasm'] });
      self.postMessage({ id: message.id, result: true });
    } else {
      const results = [];
      for (const line of message.lines) {
        const candidates = [await recognizeVariant(line.variants[0]), await recognizeVariant(line.variants[1])];
        if (candidates[0].text !== candidates[1].text) candidates.push(await recognizeVariant(line.variants[2]));
        results.push(selectConsensus(candidates));
      }
      self.postMessage({ id: message.id, result: results });
    }
  } catch (error) { self.postMessage({ id: message.id, error: error.message || String(error) }); }
};

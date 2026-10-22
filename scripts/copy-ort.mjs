// Copies onnxruntime-web's WebAssembly file into public/ so the chord model can
// load it from this site rather than a CDN.
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("public/ort", { recursive: true });
copyFileSync("node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm", "public/ort/ort-wasm-simd-threaded.wasm");

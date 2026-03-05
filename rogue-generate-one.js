#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

const COMFY_URL = process.env.COMFY_URL || 'http://localhost:8000';
const CHECKPOINT = process.env.CHECKPOINT || 'sd_xl_base_1.0.safetensors';
const LORA = process.env.LORA || 'game_icon_v1.0.safetensors';
const LORA_STRENGTH_MODEL = Number(process.env.LORA_STRENGTH_MODEL || 1);
const LORA_STRENGTH_CLIP = Number(process.env.LORA_STRENGTH_CLIP || 1);
const WIDTH = 1024;
const HEIGHT = 1024;
const STEPS = 28;
const CFG = 6;
const SAMPLER = 'euler';
const SCHEDULER = 'normal';
const DENOISE = 1;
const SEED = Math.floor(Math.random() * 0xffffffff);

const PROMPT = `single fantasy clothing item, centered, isolated object,
an elegant elven cloak, long flowing green fabric cloak,
hooded cloak made of fine cloth, leaf-pattern embroidery,
fantasy garment, draped textile, soft folds in fabric,
high detail, clean background, studio lighting, game asset illustration`.replace(/\s+/g, ' ').trim();

const NEGATIVE_PROMPT = `character, person, mannequin, background scenery,
forest scene, text, watermark, logo,
messy composition, clutter, low detail, blurry,
cropped, cut off, multiple objects`.replace(/\s+/g, ' ').trim();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_PATH = path.join(__dirname, 'rogue-cloak-of-elvenkind.png');

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function buildWorkflow(checkpoint, prompt, negativePrompt, seed, prefix) {
  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: checkpoint },
    },
    '8': {
      class_type: 'LoraLoader',
      inputs: {
        model: ['1', 0],
        clip: ['1', 1],
        lora_name: LORA,
        strength_model: LORA_STRENGTH_MODEL,
        strength_clip: LORA_STRENGTH_CLIP,
      },
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: prompt,
        clip: ['8', 1],
      },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: negativePrompt,
        clip: ['8', 1],
      },
    },
    '4': {
      class_type: 'EmptyLatentImage',
      inputs: {
        width: WIDTH,
        height: HEIGHT,
        batch_size: 1,
      },
    },
    '5': {
      class_type: 'KSampler',
      inputs: {
        model: ['8', 0],
        seed,
        steps: STEPS,
        cfg: CFG,
        sampler_name: SAMPLER,
        scheduler: SCHEDULER,
        denoise: DENOISE,
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
      },
    },
    '6': {
      class_type: 'VAEDecode',
      inputs: {
        samples: ['5', 0],
        vae: ['1', 2],
      },
    },
    '7': {
      class_type: 'SaveImage',
      inputs: {
        filename_prefix: prefix,
        images: ['6', 0],
      },
    },
  };
}

async function waitForImage(promptId, timeoutMs = 5 * 60 * 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const history = await fetchJson(`${COMFY_URL}/history/${encodeURIComponent(promptId)}`);
    const job = history?.[promptId];
    const outputs = job?.outputs;
    if (outputs) {
      for (const output of Object.values(outputs)) {
        if (Array.isArray(output.images) && output.images.length > 0) {
          return output.images[0];
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new Error(`Timed out waiting for prompt ${promptId}`);
}

async function ensureCheckpointExists(name) {
  const checkpoints = await fetchJson(`${COMFY_URL}/models/checkpoints`);
  if (!Array.isArray(checkpoints) || checkpoints.length === 0) {
    throw new Error('No checkpoints visible in ComfyUI (/models/checkpoints is empty).');
  }
  if (!checkpoints.includes(name)) {
    throw new Error(`Checkpoint '${name}' not found. Available: ${checkpoints.join(', ')}`);
  }
}

async function ensureLoraExists(name) {
  const loras = await fetchJson(`${COMFY_URL}/models/loras`);
  if (!Array.isArray(loras) || loras.length === 0) {
    throw new Error('No LoRAs visible in ComfyUI (/models/loras is empty).');
  }
  if (!loras.includes(name)) {
    throw new Error(`LoRA '${name}' not found. Available: ${loras.join(', ')}`);
  }
}

async function main() {
  console.log(`ComfyUI: ${COMFY_URL}`);
  console.log(`Checkpoint: ${CHECKPOINT}`);
  console.log(`LoRA: ${LORA} (model=${LORA_STRENGTH_MODEL}, clip=${LORA_STRENGTH_CLIP})`);
  console.log(`Output: ${OUTPUT_PATH}`);
  console.log(`Prompt: ${PROMPT}`);
  console.log(`Negative: ${NEGATIVE_PROMPT}`);

  await ensureCheckpointExists(CHECKPOINT);
  await ensureLoraExists(LORA);

  const clientId = randomUUID();
  const prefix = `rogue_single_${Date.now()}`;
  const workflow = buildWorkflow(CHECKPOINT, PROMPT, NEGATIVE_PROMPT, SEED, prefix);

  const queued = await fetchJson(`${COMFY_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  if (!queued.prompt_id) {
    throw new Error('ComfyUI did not return prompt_id.');
  }

  const imageMeta = await waitForImage(queued.prompt_id);
  const viewUrl = `${COMFY_URL}/view?filename=${encodeURIComponent(imageMeta.filename)}&subfolder=${encodeURIComponent(imageMeta.subfolder || '')}&type=${encodeURIComponent(imageMeta.type || 'output')}`;
  const data = await fetchBuffer(viewUrl);
  fs.writeFileSync(OUTPUT_PATH, data);

  console.log('Done.');
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});

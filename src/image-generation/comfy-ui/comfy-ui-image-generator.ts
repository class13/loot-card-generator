import chalk from "chalk";
import {randomUUID} from "crypto";
import {ImageGenerator} from "../image-generator.js";
import {ImageParameters} from "../image-parameters.js";
import {ComfyUIState} from "./comfy-ui-state.js";
import {ComfyUIConfiguration} from "./comfy-ui-configuration.js";
import {ComfyUIOptions} from "../../comfy-ui-options.js";
import {GeneratedImage} from "./generated-image.js";
import {WorkflowBuildParams} from "./workflow-build-params.js";

const GENERATION_TIMEOUT = 15 * 60 * 1000;

export class ComfyUIImageGenerator implements ImageGenerator {
    private config: ComfyUIConfiguration;

    private state?: ComfyUIState;
    private options?: ComfyUIOptions;

    constructor(config: ComfyUIConfiguration) {
        this.config = config
        this.state = undefined
    }

    async init(comfyOptions: ComfyUIOptions) {
        const {ckptChoices, loraChoices} = await this.loadChoices();

        if (!ckptChoices.length) {
            new Error(
                'ComfyUI is running, but no checkpoint models were found. Put an SDXL checkpoint in ComfyUI/models/checkpoints and click "Refresh" in ComfyUI.',
            );
        }
        if (!loraChoices.length) {
            new Error(
                'ComfyUI is running, but no LoRA models were found. Put game_icon_v1.0.safetensors in ComfyUI/models/loras and click "Refresh" in ComfyUI.',
            );
        }
        if (!ckptChoices.includes(comfyOptions.checkpoint)) {
            console.log(chalk.yellow(`Requested checkpoint not found: ${comfyOptions.checkpoint}`));
            console.log(chalk.yellow(`Available checkpoints: ${ckptChoices.join(', ')}`));
        }
        if (!loraChoices.includes(comfyOptions.lora)) {
            console.log(chalk.yellow(`Requested LoRA not found: ${comfyOptions.lora}`));
            console.log(chalk.yellow(`Available LoRAs: ${loraChoices.join(', ')}`));
        }

        const checkpoint = this.selectModelName(comfyOptions.checkpoint);
        const lora = this.selectModelName(comfyOptions.lora);
        console.log(chalk.green(`Checkpoint: ${checkpoint}`));
        console.log(
            chalk.green(`LoRA: ${lora} (model=${comfyOptions.loraStrengthModel}, clip=${comfyOptions.loraStrengthClip})`),
        );

        this.state = {
            checkpoint: checkpoint,
            lora: lora,
            ckptChoices: ckptChoices,
            loraChoices: loraChoices
        }
        this.options = comfyOptions;
    }

    async ensureComfyAvailable(): Promise<void> {
        try {
            await this.fetchJson(`${this.config.baseUrl}/system_stats`);
        } catch (err) {
            throw new Error(
                `ComfyUI is not reachable at ${this.config.baseUrl}. Make sure ComfyUI is started and the URL is correct. (${this.getErrorMessage(err)})`,
            );
        }
    }

    async listModels(kind: string): Promise<string[]> {
        try {
            const data = await this.fetchJson<unknown>(`${this.config.baseUrl}/models/${encodeURIComponent(kind)}`);
            return Array.isArray(data) ? data : [];
        } catch {
            return [];
        }
    }

    async listNodeChoices(nodeType: string, inputName: string): Promise<string[]> {
        try {
            const info = await this.fetchJson<Record<string, any>>(
                `${this.config.baseUrl}/object_info/${encodeURIComponent(nodeType)}`,
            );
            const values = info?.[nodeType]?.input?.required?.[inputName]?.[0];
            return Array.isArray(values) ? values : [];
        } catch {
            return [];
        }
    }

    selectModelName(preferred: string): string {
        if (!this.state!.ckptChoices.length) return preferred;
        if (this.state!.ckptChoices.includes(preferred)) return preferred;

        const preferredBase = preferred.replace(/\.[^.]+$/, '').toLowerCase();
        const exactBase = this.state!.ckptChoices.find((c) => c.replace(/\.[^.]+$/, '').toLowerCase() === preferredBase);
        if (exactBase) return exactBase;

        const fuzzy = this.state!.ckptChoices.find((c) => c.toLowerCase().includes(preferredBase));
        if (fuzzy) return fuzzy;

        return (this.state!.ckptChoices)[0];
    }

    buildWorkflow(params: WorkflowBuildParams): Record<string, unknown> {
        const {
            checkpoint,
            lora,
            loraStrengthModel,
            loraStrengthClip,
            prompt,
            negativePrompt,
            width,
            height,
            seed,
            steps,
            cfg,
            sampler,
            scheduler,
            denoise,
            prefix,
        } = params;

        return {
            '1': {
                class_type: 'CheckpointLoaderSimple',
                inputs: {ckpt_name: checkpoint},
            },
            '8': {
                class_type: 'LoraLoader',
                inputs: {
                    model: ['1', 0],
                    clip: ['1', 1],
                    lora_name: lora,
                    strength_model: loraStrengthModel,
                    strength_clip: loraStrengthClip,
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
                    width,
                    height,
                    batch_size: 1,
                },
            },
            '5': {
                class_type: 'KSampler',
                inputs: {
                    model: ['8', 0],
                    seed,
                    steps,
                    cfg,
                    sampler_name: sampler,
                    scheduler,
                    denoise,
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

    async waitForImages(promptId: string, timeoutMs: number): Promise<GeneratedImage[]> {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            const history = await this.fetchJson<Record<string, any>>(
                `${this.config.baseUrl}/history/${encodeURIComponent(promptId)}`,
            );
            const job = history?.[promptId];
            const outputs = job?.outputs;
            if (outputs) {
                const images: GeneratedImage[] = [];
                for (const output of Object.values(outputs) as Array<{ images?: GeneratedImage[] }>) {
                    if (Array.isArray(output.images)) images.push(...output.images);
                }
                if (images.length) return images;
            }
            await new Promise((resolve) => setTimeout(resolve, 600));
        }
        throw new Error(`Timed out waiting for prompt ${promptId}`);
    }

    async queuePrompt(workflow: Record<string, unknown>): Promise<string> {
        const clientId = randomUUID();
        const payload = {prompt: workflow, client_id: clientId};
        const data = await this.fetchJson<{ prompt_id?: string }>(`${this.config.baseUrl}/prompt`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload),
        });
        if (!data.prompt_id) {
            throw new Error('ComfyUI did not return a prompt_id.');
        }
        return data.prompt_id;
    }

    async loadChoices() {
        await this.ensureComfyAvailable();
        console.log(chalk.cyan('Loading ComfyUI model metadata...'));
        const [ckptFromModels, ckptFromNode, loraFromModels, loraFromNode] = await Promise.all([
            this.listModels('checkpoints'),
            this.listNodeChoices('CheckpointLoaderSimple', 'ckpt_name'),
            this.listModels('loras'),
            this.listNodeChoices('LoraLoader', 'lora_name'),
        ]);
        const ckptChoices = ckptFromModels.length ? ckptFromModels : ckptFromNode;
        const loraChoices = loraFromModels.length ? loraFromModels : loraFromNode;
        return {ckptChoices, loraChoices};
    }

    async createImage(imageParameters: ImageParameters) {

        let params: WorkflowBuildParams = {
            checkpoint: this.state!.checkpoint,
            lora: this.state!.lora,
            loraStrengthModel: this.options!.loraStrengthModel,
            loraStrengthClip: this.options!.loraStrengthClip,
            prompt: imageParameters.prompt,
            negativePrompt: imageParameters.negativePrompt,
            width: this.options!.width,
            height: this.options!.height,
            seed: this.options!.seed,
            steps: this.options!.steps,
            cfg: this.options!.cfg,
            sampler: this.options!.sampler,
            scheduler: this.options!.scheduler,
            denoise: this.options!.denoise,
            prefix: imageParameters.prefix,
        };
        const workflow = this.buildWorkflow(params);

        const promptId = await this.queuePrompt(workflow);
        const images = await this.waitForImages(promptId, GENERATION_TIMEOUT);
        const first = images[0];
        if (!first) throw new Error('No image in ComfyUI history output.');

        const viewUrl = `${this.config.baseUrl}/view?filename=${encodeURIComponent(first.filename)}&subfolder=${encodeURIComponent(first.subfolder || '')}&type=${encodeURIComponent(first.type || 'output')}`;
        return await this.fetchBuffer(viewUrl);
    }

    async fetchBuffer(url: string): Promise<Buffer> {
        let res: Response;
        try {
            res = await fetch(url);
        } catch (err) {
            throw new Error(`Could not download image from ${url}: ${this.getErrorMessage(err)}`);
        }
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
        }
        const arr = await res.arrayBuffer();
        return Buffer.from(arr);
    }

    async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
        let res: Response;
        try {
            res = await fetch(url, init);
        } catch (err) {
            throw new Error(`Could not reach ComfyUI at ${url}: ${this.getErrorMessage(err)}`);
        }
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
        }
        return (await res.json()) as T;
    }

    getErrorMessage(err: unknown): string {
        return err instanceof Error ? err.message : String(err);
    }


}
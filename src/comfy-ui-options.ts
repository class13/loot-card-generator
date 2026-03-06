export interface ComfyUIOptions {
    comfyUrl: string;
    checkpoint: string;
    lora: string;
    loraStrengthModel: number;
    loraStrengthClip: number;
    width: number;
    height: number;
    steps: number;
    cfg: number;
    sampler: string;
    scheduler: string;
    denoise: number;
    seed: number;
    draft?: boolean;
    fast?: boolean;
    limit: number | null;
}
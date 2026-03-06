export interface WorkflowBuildParams {
    checkpoint: string;
    lora: string;
    loraStrengthModel: number;
    loraStrengthClip: number;
    prompt: string;
    negativePrompt: string;
    width: number;
    height: number;
    seed: number;
    steps: number;
    cfg: number;
    sampler: string;
    scheduler: string;
    denoise: number;
    prefix: string;
}
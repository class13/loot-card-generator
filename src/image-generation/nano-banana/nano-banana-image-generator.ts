import {ImageGenerator} from "../image-generator.js";
import {ImageParameters} from "../image-parameters.js";
import {GoogleGenAI} from "@google/genai";

export interface NanoBananaConfiguration {
    model: string;
    apiKey: string;
}

function createDefaultNanoBananaConfiguration(): NanoBananaConfiguration {
    return {
        model: "gemini-3.1-flash-image-preview",
        apiKey: process.env.GEMINI_API_KEY!
    }
}

export function createNanoBananaImageGenerator(): NanoBananaImageGenerator {
    return new NanoBananaImageGenerator(
        createDefaultNanoBananaConfiguration()
    );
}

export class NanoBananaImageGenerator implements ImageGenerator {
    private readonly config: NanoBananaConfiguration;
    private ai: GoogleGenAI;

    constructor(config: NanoBananaConfiguration) {

        this.config = config;
        if (this.config.apiKey === '') {
            throw new Error("apiKey can't be empty.")
        }
        this.ai = new GoogleGenAI({
            apiKey: this.config.apiKey
        });
    }

    async createImage(imageParameters: ImageParameters): Promise<Buffer> {
        let prompt = imageParameters.prompt
        console.log(`Generating image with ${this.config.model}.`)

        const response = await this.ai.models.generateContent({
            model: this.config.model,
            contents: prompt,
        });
        for (const part of response.candidates![0].content!.parts!) {
            if (part.text) {
                throw new Error(`Gemini responded with text answer instead: ${part.text}`)
            } else if (part.inlineData) {
                const imageData = part.inlineData.data!;
                return Buffer.from(imageData, "base64")
            }
        }
        throw new Error("Unexpected errors. I don't know how this happens.")
    }

}

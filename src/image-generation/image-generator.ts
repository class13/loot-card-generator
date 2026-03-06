import {ImageParameters} from "./image-parameters.js";

export interface ImageGenerator {
    createImage(imageParameters: ImageParameters): Promise<Buffer>
}
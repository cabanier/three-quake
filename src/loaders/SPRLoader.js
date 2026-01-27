import { BinaryReader } from '../utils/BinaryReader.js';
import { QUAKE_PALETTE } from './Palette.js';

/**
 * SPRLoader - Loads Quake sprite files (.spr)
 *
 * Sprite orientation types:
 * - SPR_VP_PARALLEL (0): Faces viewer, flat (particles, explosions)
 * - SPR_FACING_UPRIGHT (1): Faces viewer, always vertical (torches)
 * - SPR_VP_PARALLEL_UPRIGHT (2): Like parallel but constrained to vertical
 * - SPR_ORIENTED (3): Fixed orientation in world space
 * - SPR_VP_PARALLEL_ORIENTED (4): Combination
 *
 * Frame types:
 * - SPR_SINGLE (0): Single frame
 * - SPR_GROUP (1): Group of frames for animation
 */

const SPR_MAGIC = 0x50534449; // "IDSP"
const SPR_VERSION = 1;

// Orientation types
export const SPR_TYPE = {
    VP_PARALLEL: 0,          // Always faces camera
    FACING_UPRIGHT: 1,       // Faces camera but vertical only
    VP_PARALLEL_UPRIGHT: 2,  // Parallel but constrained vertical
    ORIENTED: 3,             // Fixed orientation
    VP_PARALLEL_ORIENTED: 4  // Parallel oriented
};

export class SPRLoader {
    constructor() {
        this.type = 0;
        this.texFormat = 0;
        this.boundingRadius = 0;
        this.width = 0;
        this.height = 0;
        this.numFrames = 0;
        this.beamLength = 0;
        this.syncType = 0;
        this.frames = [];
    }

    /**
     * Load sprite from ArrayBuffer
     * @param {ArrayBuffer} buffer - SPR file data
     * @returns {SPRLoader} this
     */
    load(buffer) {
        const reader = new BinaryReader(buffer);

        // Read header
        const magic = reader.readInt32();
        if (magic !== SPR_MAGIC) {
            throw new Error(`Invalid SPR magic: 0x${magic.toString(16)}, expected IDSP`);
        }

        const version = reader.readInt32();
        if (version !== SPR_VERSION) {
            throw new Error(`Invalid SPR version: ${version}, expected ${SPR_VERSION}`);
        }

        this.type = reader.readInt32();
        this.texFormat = reader.readInt32();
        this.boundingRadius = reader.readFloat32();
        this.width = reader.readInt32();
        this.height = reader.readInt32();
        this.numFrames = reader.readInt32();
        this.beamLength = reader.readFloat32();
        this.syncType = reader.readInt32();

        // Read frames
        for (let i = 0; i < this.numFrames; i++) {
            const frameType = reader.readInt32();

            if (frameType === 0) {
                // Single frame
                this.frames.push(this.readFrame(reader));
            } else {
                // Frame group
                const group = this.readFrameGroup(reader);
                this.frames.push(group);
            }
        }

        console.log(`SPR loaded: ${this.width}x${this.height}, ${this.numFrames} frames, type=${this.type}`);
        return this;
    }

    readFrame(reader) {
        const originX = reader.readInt32();
        const originY = reader.readInt32();
        const width = reader.readInt32();
        const height = reader.readInt32();

        // Read pixel data (indexed color)
        const pixelCount = width * height;
        const pixels = new Uint8Array(pixelCount);
        for (let i = 0; i < pixelCount; i++) {
            pixels[i] = reader.readUint8();
        }

        // Convert to RGBA
        const rgba = this.indexedToRGBA(pixels, width, height);

        return {
            type: 'single',
            originX,
            originY,
            width,
            height,
            pixels,
            rgba
        };
    }

    readFrameGroup(reader) {
        const numFrames = reader.readInt32();

        // Read frame intervals
        const intervals = [];
        for (let i = 0; i < numFrames; i++) {
            intervals.push(reader.readFloat32());
        }

        // Read frames
        const frames = [];
        for (let i = 0; i < numFrames; i++) {
            frames.push(this.readFrame(reader));
        }

        return {
            type: 'group',
            numFrames,
            intervals,
            frames
        };
    }

    /**
     * Convert indexed color pixels to RGBA
     * Index 255 is treated as transparent
     */
    indexedToRGBA(indexed, width, height) {
        const rgba = new Uint8Array(width * height * 4);

        for (let i = 0; i < indexed.length; i++) {
            const palIdx = indexed[i];
            const dstIdx = i * 4;

            if (palIdx === 255) {
                // Transparent
                rgba[dstIdx] = 0;
                rgba[dstIdx + 1] = 0;
                rgba[dstIdx + 2] = 0;
                rgba[dstIdx + 3] = 0;
            } else {
                rgba[dstIdx] = QUAKE_PALETTE[palIdx * 3];
                rgba[dstIdx + 1] = QUAKE_PALETTE[palIdx * 3 + 1];
                rgba[dstIdx + 2] = QUAKE_PALETTE[palIdx * 3 + 2];
                rgba[dstIdx + 3] = 255;
            }
        }

        return rgba;
    }

    /**
     * Get frame for animation time
     * @param {number} time - Animation time
     * @param {number} frameIndex - Base frame index
     * @returns {Object} Frame data with rgba, width, height, originX, originY
     */
    getFrame(time, frameIndex = 0) {
        if (frameIndex >= this.frames.length) {
            frameIndex = 0;
        }

        const frame = this.frames[frameIndex];

        if (frame.type === 'single') {
            return frame;
        } else {
            // Animated group - find current frame based on time
            const totalDuration = frame.intervals.reduce((a, b) => a + b, 0);
            const loopTime = time % totalDuration;

            let elapsed = 0;
            for (let i = 0; i < frame.numFrames; i++) {
                elapsed += frame.intervals[i];
                if (loopTime < elapsed) {
                    return frame.frames[i];
                }
            }

            return frame.frames[frame.numFrames - 1];
        }
    }
}

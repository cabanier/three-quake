import * as THREE from 'three';

/**
 * LightmapBuilder - Builds lightmap atlas from BSP lighting data
 *
 * Quake lightmaps:
 * - 1 luxel per 16 world units
 * - Up to 4 style layers per face (for animated lights)
 * - Grayscale values 0-255
 */

const ATLAS_SIZE = 1024;  // Size of the lightmap atlas texture
const LUXEL_SIZE = 16;    // World units per lightmap pixel

export class LightmapBuilder {
    constructor(bsp) {
        this.bsp = bsp;
        this.atlasSize = ATLAS_SIZE;
        this.faceLightmapInfo = new Map();  // faceIndex -> { x, y, width, height, styles, offset }
        this.atlasTexture = null;
        this.atlasData = null; // Raw RGBA data for dynamic updates

        // Store lightmap info for dynamic updates
        this.lightmapFaces = []; // Array of face lightmap metadata
    }

    build() {
        if (!this.bsp.lighting || this.bsp.lighting.length === 0) {
            console.log('No lighting data in BSP');
            return null;
        }

        // Calculate lightmap size for each face and pack into atlas
        const lightmaps = this.collectFaceLightmaps();

        if (lightmaps.length === 0) {
            console.log('No lightmapped faces found');
            return null;
        }

        // Pack lightmaps into atlas
        this.packLightmaps(lightmaps);

        // Store for dynamic updates
        this.lightmapFaces = lightmaps;

        // Create atlas texture
        this.createAtlasTexture(lightmaps);

        console.log(`Lightmap atlas created: ${this.atlasSize}x${this.atlasSize}, ${lightmaps.length} faces`);

        return this.atlasTexture;
    }

    collectFaceLightmaps() {
        const lightmaps = [];

        for (let i = 0; i < this.bsp.faces.length; i++) {
            const face = this.bsp.faces[i];

            // Skip faces without lightmaps
            if (face.lightmapOffset < 0 || face.styles[0] === 255) {
                continue;
            }

            // Check if this is a special texture (sky, water, etc)
            const texinfo = this.bsp.texinfo[face.texinfoNum];
            if (texinfo.flags & 1) {  // TEX_SPECIAL
                continue;
            }

            const size = this.bsp.getFaceLightmapSize(i);

            // Validate lightmap size
            if (size.width <= 0 || size.height <= 0 ||
                size.width > 256 || size.height > 256) {
                continue;
            }

            lightmaps.push({
                faceIndex: i,
                width: size.width,
                height: size.height,
                minS: size.minS,
                minT: size.minT,
                offset: face.lightmapOffset,
                styles: [...face.styles], // Copy styles array
                atlasX: 0,
                atlasY: 0
            });
        }

        // Sort by height (descending) for better packing
        lightmaps.sort((a, b) => b.height - a.height);

        return lightmaps;
    }

    packLightmaps(lightmaps) {
        // Simple shelf packing algorithm
        let shelfY = 0;
        let shelfHeight = 0;
        let shelfX = 0;
        const padding = 1;  // 1 pixel padding to avoid bleeding

        for (const lm of lightmaps) {
            const w = lm.width + padding * 2;
            const h = lm.height + padding * 2;

            // Check if fits on current shelf
            if (shelfX + w > this.atlasSize) {
                // Start new shelf
                shelfY += shelfHeight;
                shelfHeight = 0;
                shelfX = 0;
            }

            // Check if we need a larger atlas
            if (shelfY + h > this.atlasSize) {
                // Double atlas size and retry
                this.atlasSize *= 2;
                if (this.atlasSize > 4096) {
                    console.warn('Lightmap atlas too large, some faces will be unlit');
                    break;
                }
                return this.packLightmaps(lightmaps);
            }

            lm.atlasX = shelfX + padding;
            lm.atlasY = shelfY + padding;

            // Store info for UV calculation
            this.faceLightmapInfo.set(lm.faceIndex, {
                x: lm.atlasX,
                y: lm.atlasY,
                width: lm.width,
                height: lm.height,
                minS: lm.minS,
                minT: lm.minT,
                styles: lm.styles,
                offset: lm.offset
            });

            shelfX += w;
            shelfHeight = Math.max(shelfHeight, h);
        }
    }

    createAtlasTexture(lightmaps, lightStyleValues = null) {
        // Create RGBA texture data
        this.atlasData = new Uint8Array(this.atlasSize * this.atlasSize * 4);

        // Fill with neutral gray (for debugging unlit areas)
        for (let i = 0; i < this.atlasData.length; i += 4) {
            this.atlasData[i] = 128;
            this.atlasData[i + 1] = 128;
            this.atlasData[i + 2] = 128;
            this.atlasData[i + 3] = 255;
        }

        // Render lightmaps into atlas
        this.renderLightmaps(lightmaps, lightStyleValues);

        // Create Three.js texture
        this.atlasTexture = new THREE.DataTexture(
            this.atlasData,
            this.atlasSize,
            this.atlasSize,
            THREE.RGBAFormat
        );
        this.atlasTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.atlasTexture.wrapT = THREE.ClampToEdgeWrapping;
        this.atlasTexture.magFilter = THREE.LinearFilter;
        this.atlasTexture.minFilter = THREE.LinearFilter;
        this.atlasTexture.needsUpdate = true;

        return this.atlasTexture;
    }

    /**
     * Render all lightmaps into the atlas
     * @param {Array} lightmaps - Array of lightmap metadata
     * @param {Float32Array|null} lightStyleValues - Current light style values (null for default)
     */
    renderLightmaps(lightmaps, lightStyleValues = null) {
        const lighting = this.bsp.lighting;

        for (const lm of lightmaps) {
            if (!this.faceLightmapInfo.has(lm.faceIndex)) continue;

            const size = lm.width * lm.height;

            // Count number of style layers
            let numStyles = 0;
            for (let s = 0; s < 4 && lm.styles[s] !== 255; s++) {
                numStyles++;
            }

            // Process each pixel
            for (let y = 0; y < lm.height; y++) {
                for (let x = 0; x < lm.width; x++) {
                    let totalLight = 0;

                    // Combine all style layers
                    for (let s = 0; s < numStyles; s++) {
                        const styleIndex = lm.styles[s];
                        const srcIndex = lm.offset + (s * size) + y * lm.width + x;

                        if (srcIndex < 0 || srcIndex >= lighting.length) {
                            continue;
                        }

                        // Get base light value from BSP (0-255)
                        const baseLight = lighting[srcIndex];

                        // Apply light style multiplier
                        let styleScale = 256; // Default normal brightness
                        if (lightStyleValues && styleIndex < lightStyleValues.length) {
                            styleScale = lightStyleValues[styleIndex];
                        }

                        // Quake formula: light = baseLight * styleScale / 256
                        totalLight += (baseLight * styleScale) >> 8;
                    }

                    // Clamp to 0-255
                    // Original Quake applies gamma to display, not lightmap data
                    // Default gamma is 1.0 (linear). Use raw values for accuracy.
                    // Brightness can be adjusted via Renderer.setBrightness()
                    let lightValue = Math.min(255, totalLight);

                    const dstX = lm.atlasX + x;
                    const dstY = lm.atlasY + y;
                    const dstIndex = (dstY * this.atlasSize + dstX) * 4;

                    this.atlasData[dstIndex] = lightValue;
                    this.atlasData[dstIndex + 1] = lightValue;
                    this.atlasData[dstIndex + 2] = lightValue;
                    this.atlasData[dstIndex + 3] = 255;
                }
            }
        }
    }

    /**
     * Update lightmap atlas with new light style values
     * Call this when light styles change (flickering lights, etc.)
     * @param {Float32Array} lightStyleValues - Array of 64 light style values
     */
    updateLightStyles(lightStyleValues) {
        if (!this.atlasData || !this.lightmapFaces.length) return;

        // Re-render lightmaps with new style values
        this.renderLightmaps(this.lightmapFaces, lightStyleValues);

        // Update texture
        if (this.atlasTexture) {
            this.atlasTexture.needsUpdate = true;
        }
    }

    // Get lightmap UV for a vertex on a face
    getLightmapUV(faceIndex, vertex, texinfo) {
        const info = this.faceLightmapInfo.get(faceIndex);

        if (!info) {
            return { u: 0.5, v: 0.5 };  // Default to middle of atlas
        }

        // Calculate texture coordinates
        const s = vertex.x * texinfo.s.x + vertex.y * texinfo.s.y + vertex.z * texinfo.s.z + texinfo.s.offset;
        const t = vertex.x * texinfo.t.x + vertex.y * texinfo.t.y + vertex.z * texinfo.t.z + texinfo.t.offset;

        // Calculate local UV within face's lightmap (0 to 1)
        const localU = (s - info.minS) / (info.width * LUXEL_SIZE);
        const localV = (t - info.minT) / (info.height * LUXEL_SIZE);

        // Convert to atlas UV (add half pixel offset for center sampling)
        const atlasU = (info.x + localU * info.width + 0.5) / this.atlasSize;
        const atlasV = (info.y + localV * info.height + 0.5) / this.atlasSize;

        return { u: atlasU, v: atlasV };
    }

    hasLightmap(faceIndex) {
        return this.faceLightmapInfo.has(faceIndex);
    }
}

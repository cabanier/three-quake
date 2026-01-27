import * as THREE from 'three';

/**
 * LightManager - Handles lightmaps and dynamic lights
 *
 * Quake uses:
 * - Pre-baked lightmaps in BSP
 * - Animated light styles (flickering, pulsing)
 * - Dynamic lights from projectiles/explosions
 */

// Light style animations (from Quake)
// Each character represents brightness (a=0, z=full)
export const LIGHT_STYLES = {
    0: 'm',  // Normal
    1: 'mmnmmommommnonmmonqnmmo',  // Flicker
    2: 'abcdefghijklmnopqrstuvwxyzyxwvutsrqponmlkjihgfedcba',  // Slow pulse
    3: 'mmmmmaaaaammmmmaaaaaabcdefgabcdefg',  // Candle
    4: 'mamamamamama',  // Fast strobe
    5: 'jklmnopqrstuvwxyzyxwvutsrqponmlkj',  // Gentle pulse
    6: 'nmonqnmomnmomomno',  // Flicker 2
    7: 'mmmaaaabcdefgmmmmaaaammmaamm',  // Candle 2
    8: 'mmmaaammmaaammmabcdefaaaammmmabcdefmmmaaaa',  // Candle 3
    9: 'aaaaaaaazzzzzzzz',  // Slow strobe
    10: 'mmamammmmammamamaaamammma',  // Fluorescent
    11: 'abcdefghijklmnopqrrqponmlkjihgfedcba',  // Slow pulse 2
    12: 'm',  // Used for switchable lights (on)
};

export class LightManager {
    constructor() {
        this.dynamicLights = [];
        this.maxDynamicLights = 32;
        this.time = 0;
    }

    update(deltaTime) {
        this.time += deltaTime;

        // Update dynamic lights
        for (let i = this.dynamicLights.length - 1; i >= 0; i--) {
            const light = this.dynamicLights[i];
            light.time -= deltaTime;

            if (light.time <= 0) {
                // Remove expired light
                this.dynamicLights.splice(i, 1);
                continue;
            }

            // Update intensity based on decay
            light.currentIntensity = light.intensity * (light.time / light.duration);
        }
    }

    getLightStyleValue(style) {
        const pattern = LIGHT_STYLES[style] || 'm';
        const index = Math.floor(this.time * 10) % pattern.length;
        const char = pattern[index];

        // Convert 'a'-'z' to 0-1
        return (char.charCodeAt(0) - 97) / 25;
    }

    addDynamicLight(position, intensity, color, duration) {
        if (this.dynamicLights.length >= this.maxDynamicLights) {
            // Remove oldest light
            this.dynamicLights.shift();
        }

        const light = {
            position: { ...position },
            intensity: intensity,
            currentIntensity: intensity,
            color: color || { r: 1, g: 1, b: 1 },
            duration: duration,
            time: duration
        };

        this.dynamicLights.push(light);
        return light;
    }

    createMuzzleFlash(position) {
        return this.addDynamicLight(
            position,
            200,
            { r: 1, g: 0.8, b: 0.4 },
            0.1
        );
    }

    createExplosion(position) {
        return this.addDynamicLight(
            position,
            350,
            { r: 1, g: 0.5, b: 0.2 },
            0.5
        );
    }

    createRocketTrail(position) {
        return this.addDynamicLight(
            position,
            200,
            { r: 1, g: 0.6, b: 0.3 },
            0.01
        );
    }

    getDynamicLightsNear(position, radius) {
        const result = [];

        for (const light of this.dynamicLights) {
            const dx = light.position.x - position.x;
            const dy = light.position.y - position.y;
            const dz = light.position.z - position.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (dist <= radius + light.currentIntensity) {
                result.push({
                    light,
                    distance: dist
                });
            }
        }

        return result;
    }

    // Create lightmap texture for a face
    createLightmapTexture(lighting, offset, width, height, styles) {
        if (!lighting || offset < 0) {
            return this.createDefaultLightmap();
        }

        const size = width * height;
        const data = new Uint8Array(size * 4);

        // Quake lightmaps can have up to 4 styles per face
        // We'll blend them based on current style values
        for (let i = 0; i < size; i++) {
            let r = 0, g = 0, b = 0;

            for (let s = 0; s < 4; s++) {
                if (styles[s] === 255) break; // No more styles

                const styleValue = this.getLightStyleValue(styles[s]);
                const lightValue = lighting[offset + s * size + i];

                r += lightValue * styleValue;
                g += lightValue * styleValue;
                b += lightValue * styleValue;
            }

            // Clamp and gamma correct
            r = Math.min(255, r);
            g = Math.min(255, g);
            b = Math.min(255, b);

            data[i * 4] = r;
            data[i * 4 + 1] = g;
            data[i * 4 + 2] = b;
            data[i * 4 + 3] = 255;
        }

        const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearFilter;
        texture.needsUpdate = true;

        return texture;
    }

    createDefaultLightmap() {
        const data = new Uint8Array(4);
        data[0] = 255;
        data[1] = 255;
        data[2] = 255;
        data[3] = 255;

        const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
        texture.needsUpdate = true;
        return texture;
    }
}

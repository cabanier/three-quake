/**
 * LightStyles - Quake animated light system
 *
 * Quake light styles are defined by letter strings where:
 * - 'a' = 0 (no light)
 * - 'm' = 12 (normal brightness, 12*22=264 ≈ 256)
 * - 'z' = 25 (double bright, 25*22=550)
 *
 * Each surface can have up to 4 light styles applied.
 * The light values are updated at 10 Hz (cl.time * 10).
 */

// Default light style patterns from Quake
// These are set by the progs.dat or can be customized per-map
const DEFAULT_LIGHT_STYLES = [
    'm',                                                        // 0: normal
    'mmnmmommommnonmmonqnmmo',                                   // 1: flicker (first variety)
    'abcdefghijklmnopqrstuvwxyzyxwvutsrqponmlkjihgfedcba',       // 2: slow strong pulse
    'mmmmmaaaaammmmmaaaaaabcdefgabcdefg',                        // 3: candle (first variety)
    'mamamamamama',                                              // 4: fast strobe
    'jklmnopqrstuvwxyzyxwvutsrqponmlkj',                         // 5: gentle pulse 1
    'nmonqnmomnmomomno',                                         // 6: flicker (second variety)
    'mmmaaaabcdefgmmmmaaaammmaamm',                              // 7: candle (second variety)
    'mmmaaammmaaammmabcdefaaaammmmabcdefmmmaaaa',                // 8: candle (third variety)
    'aaaaaaaazzzzzzzz',                                          // 9: slow strobe (fourth variety)
    'mmamammmmammamamaaamammma',                                 // 10: fluorescent flicker
    'abcdefghijklmnopqrrqponmlkjihgfedcba',                      // 11: slow pulse not fade to black
    // 12-63 are typically 'm' (normal) unless overridden by map
];

// Fill remaining styles with normal brightness
for (let i = DEFAULT_LIGHT_STYLES.length; i < 64; i++) {
    DEFAULT_LIGHT_STYLES.push('m');
}

const MAX_LIGHTSTYLES = 64;

export class LightStyles {
    constructor() {
        // Light style patterns (can be customized by map)
        this.patterns = [...DEFAULT_LIGHT_STYLES];

        // Current computed values for each style (0-256 scale)
        this.values = new Float32Array(MAX_LIGHTSTYLES);

        // Initialize all to normal brightness (256)
        for (let i = 0; i < MAX_LIGHTSTYLES; i++) {
            this.values[i] = 256;
        }

        // Flame entities (for model animation, separate from lightmaps)
        this.flames = [];
        this.time = 0;

        // Callback for when light values change (for lightmap updates)
        this.onUpdate = null;
    }

    /**
     * Set a light style pattern (called when loading a map or by server)
     * @param {number} styleIndex - Style index (0-63)
     * @param {string} pattern - Letter pattern string
     */
    setStyle(styleIndex, pattern) {
        if (styleIndex >= 0 && styleIndex < MAX_LIGHTSTYLES) {
            this.patterns[styleIndex] = pattern || 'm';
        }
    }

    /**
     * Reset all styles to defaults (call when loading a new map)
     */
    reset() {
        this.patterns = [...DEFAULT_LIGHT_STYLES];
        this.flames = [];
        this.time = 0;
    }

    /**
     * Update light style values based on current time
     * Should be called every frame
     * @param {number} deltaTime - Time since last update in seconds
     */
    update(deltaTime) {
        this.time += deltaTime;

        // Quake updates light styles at 10 Hz
        const frameIndex = Math.floor(this.time * 10);

        let changed = false;

        for (let i = 0; i < MAX_LIGHTSTYLES; i++) {
            const pattern = this.patterns[i];

            if (!pattern || pattern.length === 0) {
                if (this.values[i] !== 256) {
                    this.values[i] = 256;
                    changed = true;
                }
                continue;
            }

            // Get current position in pattern
            const k = frameIndex % pattern.length;

            // Convert letter to value: 'a'=0, 'm'=12, 'z'=25
            // Then multiply by 22 to get 0-550 range
            const charCode = pattern.charCodeAt(k) - 'a'.charCodeAt(0);
            const newValue = charCode * 22;

            if (this.values[i] !== newValue) {
                this.values[i] = newValue;
                changed = true;
            }
        }

        // Notify listeners if values changed
        if (changed && this.onUpdate) {
            this.onUpdate(this.values);
        }

        return changed;
    }

    /**
     * Get current value for a light style
     * @param {number} styleIndex - Style index (0-63)
     * @returns {number} Light value (0-~550, with 256 being normal)
     */
    getValue(styleIndex) {
        if (styleIndex >= 0 && styleIndex < MAX_LIGHTSTYLES) {
            return this.values[styleIndex];
        }
        return 256; // Default normal brightness
    }

    /**
     * Get normalized value for a light style (0.0 to ~2.0)
     * @param {number} styleIndex - Style index (0-63)
     * @returns {number} Normalized light value
     */
    getNormalizedValue(styleIndex) {
        return this.getValue(styleIndex) / 256.0;
    }

    /**
     * Calculate combined light value for a surface with multiple styles
     * @param {number[]} styles - Array of up to 4 style indices (255 = unused)
     * @returns {number} Combined light multiplier (normalized)
     */
    getCombinedValue(styles) {
        let total = 0;
        let count = 0;

        for (let i = 0; i < 4 && i < styles.length; i++) {
            if (styles[i] === 255) break;
            total += this.getValue(styles[i]);
            count++;
        }

        if (count === 0) return 1.0;

        // Return average, normalized
        return (total / count) / 256.0;
    }

    // Flame model animation (separate from lightmap styles)
    addFlame(flame) {
        this.flames.push(flame);
    }

    updateFlames(deltaTime, aliasRenderer) {
        for (const flame of this.flames) {
            if (!flame.mesh) continue;

            flame.time = (flame.time || 0) + deltaTime;

            // Animate flame frame groups using time
            // GLQuake: pose = (int)(cl.time / interval) % numposes
            // Flame models have frame 0 as a frame group with multiple poses
            if (flame.modelData && flame.modelData.mdl && aliasRenderer) {
                // Pass time to setFrame so frame groups animate correctly
                aliasRenderer.setFrame(flame.mesh, 0, flame.time);
            }
        }
    }

    clear() {
        this.flames = [];
    }
}

// Export default patterns for reference
export { DEFAULT_LIGHT_STYLES, MAX_LIGHTSTYLES };

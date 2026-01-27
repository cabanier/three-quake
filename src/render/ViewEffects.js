/**
 * ViewEffects - Screen overlay effects for damage, powerups, underwater
 *
 * Original Quake uses V_CalcBlend to calculate screen tint:
 * - Damage flash (red)
 * - Quad Damage (purple/blue)
 * - Invulnerability (red/yellow flash)
 * - Ring of Shadows (gray)
 * - Biosuit (green)
 * - Underwater (blue/green/red based on liquid type)
 * - Bonus flash (yellow pickup glow)
 */

export class ViewEffects {
    constructor(container) {
        this.container = container;

        // Create overlay element
        this.overlay = document.createElement('div');
        this.overlay.style.position = 'absolute';
        this.overlay.style.top = '0';
        this.overlay.style.left = '0';
        this.overlay.style.width = '100%';
        this.overlay.style.height = '100%';
        this.overlay.style.pointerEvents = 'none';
        this.overlay.style.transition = 'none';
        this.overlay.style.mixBlendMode = 'multiply';
        container.appendChild(this.overlay);

        // Current blend color (RGBA 0-1)
        this.blend = { r: 0, g: 0, b: 0, a: 0 };

        // Effect timers
        this.bonusTime = 0;

        // Underwater effect state
        this.underwaterTime = 0;
        this.isUnderwater = false;
    }

    /**
     * Update view effects based on player state
     * @param {Object} player - Player entity with powerup states
     * @param {number} deltaTime - Frame time
     */
    update(player, deltaTime) {
        // Reset blend
        let r = 0, g = 0, b = 0, a = 0;

        if (!player) {
            this.applyBlend(r, g, b, a);
            return;
        }

        // Damage flash - color depends on armor vs blood damage (view.c:343-360)
        // damagePercent is set by dealDamage() based on damage amount
        // damageColor is set based on whether armor or blood absorbed more
        if (player.damagePercent > 0) {
            // Decay at 150 per second (like original V_UpdatePalette)
            player.damagePercent -= deltaTime * 150;
            if (player.damagePercent < 0) player.damagePercent = 0;

            // Convert percent (0-150) to alpha (0-0.5)
            const intensity = (player.damagePercent / 150) * 0.5;

            // Color based on damage type (original Quake view.c:343-360)
            // - armor > blood: (200, 100, 100) / 255 - brownish red
            // - armor > 0: (220, 50, 50) / 255 - red-orange
            // - blood only: (255, 0, 0) - pure red
            const damageColor = player.damageColor || { r: 255, g: 0, b: 0 };
            r += (damageColor.r / 255);
            g += (damageColor.g / 255);
            b += (damageColor.b / 255);
            a = Math.max(a, intensity);
        }

        // Bonus flash (yellow) - item pickup glow
        if (player.bonusTime > 0) {
            player.bonusTime -= deltaTime;
            const intensity = Math.min(player.bonusTime * 2, 0.3);
            r += 0.85 * intensity;
            g += 0.75 * intensity;
            b += 0.1 * intensity;
            a = Math.max(a, intensity);
        }

        // Quad Damage (blue tint) - Original: cshift 0,0,255,30 (30% alpha)
        // In last 3 seconds, original flashes by toggling the effect on/off
        if (player.quadTime > 0) {
            // Fixed 30% intensity like original (30/255 ≈ 0.12)
            // In last 3 seconds, toggle effect on/off (like original V_UpdatePalette)
            let show = true;
            if (player.quadTime < 3) {
                show = Math.floor(player.quadTime * 4) % 2 === 0; // Toggle ~4 times/sec
            }
            if (show) {
                const intensity = 0.12;  // 30/255 = 0.118
                b += 1.0;
                a = Math.max(a, intensity);
            }
        }

        // Invulnerability (yellow tint) - Original: cshift 255,255,0,30
        if (player.invincibleTime > 0) {
            let show = true;
            if (player.invincibleTime < 3) {
                show = Math.floor(player.invincibleTime * 4) % 2 === 0;
            }
            if (show) {
                const intensity = 0.12;  // 30/255
                r += 1.0;
                g += 1.0;
                a = Math.max(a, intensity);
            }
        }

        // Ring of Shadows (darkening) - Original: cshift 0,0,0,100
        // Note: this is a darkening effect, not a color tint
        if (player.invisibleTime > 0) {
            let show = true;
            if (player.invisibleTime < 3) {
                show = Math.floor(player.invisibleTime * 4) % 2 === 0;
            }
            if (show) {
                // Dark tint (100/255 ≈ 0.39)
                const intensity = 0.39;
                // Black overlay for darkening
                a = Math.max(a, intensity * 0.5); // Halved for visibility
            }
        }

        // Biosuit (green tint) - Original: cshift 0,255,0,20
        if (player.suitTime > 0) {
            let show = true;
            if (player.suitTime < 3) {
                show = Math.floor(player.suitTime * 4) % 2 === 0;
            }
            if (show) {
                const intensity = 0.08;  // 20/255
                g += 1.0;
                a = Math.max(a, intensity);
            }
        }

        // Underwater effects based on liquid type
        // waterLevel: 0=none, 1=feet, 2=waist, 3=eyes
        // waterType: -3=water, -4=slime, -5=lava
        if (player.waterLevel >= 3) {
            const waterIntensity = 0.25;

            if (player.waterType === -5) {
                // Lava - red/orange
                r += 1.0 * waterIntensity;
                g += 0.3 * waterIntensity;
            } else if (player.waterType === -4) {
                // Slime - green
                g += 1.0 * waterIntensity;
                r += 0.3 * waterIntensity;
            } else {
                // Water - blue/cyan
                b += 1.0 * waterIntensity;
                g += 0.5 * waterIntensity;
            }
            a = Math.max(a, waterIntensity);

            // Track underwater state for distortion
            this.isUnderwater = true;
            this.underwaterTime += deltaTime;
        } else {
            this.isUnderwater = false;
            this.underwaterTime = 0;
        }

        // Clamp values
        r = Math.min(r, 1);
        g = Math.min(g, 1);
        b = Math.min(b, 1);
        a = Math.min(a, 0.5); // Don't go too opaque

        this.applyBlend(r, g, b, a);

        // Apply underwater screen distortion
        this.applyUnderwaterDistortion();
    }

    /**
     * Apply underwater screen distortion effect
     * Original Quake: v_blend warp using sine-based UV offset
     */
    applyUnderwaterDistortion() {
        // Find the game canvas to apply distortion
        const canvas = this.container.querySelector('canvas');
        if (!canvas) return;

        if (this.isUnderwater) {
            // Apply wobble effect using CSS transforms
            // This mimics the original Quake underwater warp
            const wobbleAmount = 2; // pixels
            const wobbleSpeed = 3; // cycles per second
            const offsetX = Math.sin(this.underwaterTime * wobbleSpeed * Math.PI * 2) * wobbleAmount;
            const offsetY = Math.cos(this.underwaterTime * wobbleSpeed * 1.3 * Math.PI * 2) * wobbleAmount;

            canvas.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
            canvas.style.filter = 'blur(0.5px)';
        } else {
            canvas.style.transform = '';
            canvas.style.filter = '';
        }
    }

    /**
     * Apply blend color to overlay
     */
    applyBlend(r, g, b, a) {
        this.blend = { r, g, b, a };

        if (a < 0.01) {
            this.overlay.style.backgroundColor = 'transparent';
        } else {
            const rInt = Math.floor(r * 255);
            const gInt = Math.floor(g * 255);
            const bInt = Math.floor(b * 255);
            this.overlay.style.backgroundColor = `rgba(${rInt}, ${gInt}, ${bInt}, ${a})`;
        }
    }

    /**
     * Trigger damage flash - called externally to add damage
     * Note: Normally damage is handled by player.damagePercent directly
     */
    damageFlash(amount) {
        // This method can be used for external damage triggering
        // The actual flash is handled via player.damagePercent in update()
    }

    /**
     * Trigger bonus flash (item pickup)
     */
    bonusFlash() {
        this.bonusTime = 0.4;
    }

    /**
     * Clear all effects
     */
    clear() {
        this.blend = { r: 0, g: 0, b: 0, a: 0 };
        this.bonusTime = 0;
        this.applyBlend(0, 0, 0, 0);
    }

    /**
     * Remove overlay from DOM
     */
    destroy() {
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
    }
}

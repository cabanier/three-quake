import * as THREE from 'three';
import { SPRLoader, SPR_TYPE } from '../loaders/SPRLoader.js';

/**
 * SpriteRenderer - Renders Quake sprites in Three.js
 *
 * Creates billboards with proper orientation based on sprite type
 */

export class SpriteRenderer {
    constructor(pak) {
        this.pak = pak;
        this.cache = new Map(); // Loaded sprite data
        this.instances = [];    // Active sprite instances
    }

    /**
     * Load a sprite file
     * @param {string} name - Sprite path (e.g., 'progs/s_bubble.spr')
     * @returns {SPRLoader} Sprite data
     */
    async loadSprite(name) {
        if (this.cache.has(name)) {
            return this.cache.get(name);
        }

        const data = this.pak.get(name);
        if (!data) {
            console.warn(`Sprite not found: ${name}`);
            return null;
        }

        const spr = new SPRLoader();
        spr.load(data);

        // Create textures for all frames
        spr.textures = this.createTextures(spr);

        this.cache.set(name, spr);
        return spr;
    }

    /**
     * Create Three.js textures from sprite frames
     */
    createTextures(spr) {
        const textures = [];

        for (const frame of spr.frames) {
            if (frame.type === 'single') {
                textures.push(this.createTextureFromFrame(frame));
            } else {
                // Group - create textures for all subframes
                const groupTextures = frame.frames.map(f => this.createTextureFromFrame(f));
                textures.push(groupTextures);
            }
        }

        return textures;
    }

    createTextureFromFrame(frame) {
        const texture = new THREE.DataTexture(
            frame.rgba,
            frame.width,
            frame.height,
            THREE.RGBAFormat
        );
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.needsUpdate = true;

        return {
            texture,
            width: frame.width,
            height: frame.height,
            originX: frame.originX,
            originY: frame.originY
        };
    }

    /**
     * Create a sprite instance (mesh)
     * @param {SPRLoader} spriteData - Loaded sprite
     * @returns {THREE.Mesh} Sprite mesh
     */
    createInstance(spriteData) {
        if (!spriteData || !spriteData.textures || spriteData.textures.length === 0) {
            return null;
        }

        // Get first frame for initial size
        const firstFrame = spriteData.getFrame(0);

        // Create plane geometry
        // Scale by some factor - original Quake sprites are small
        const scale = 1;
        const geometry = new THREE.PlaneGeometry(
            firstFrame.width * scale,
            firstFrame.height * scale
        );

        // Create material with transparency
        const texInfo = spriteData.textures[0];
        const tex = Array.isArray(texInfo) ? texInfo[0] : texInfo;

        const material = new THREE.MeshBasicMaterial({
            map: tex.texture,
            transparent: true,
            alphaTest: 0.1,
            side: THREE.DoubleSide,
            depthWrite: false
        });

        const mesh = new THREE.Mesh(geometry, material);

        // Store sprite data for updates
        mesh.userData.spriteData = spriteData;
        mesh.userData.spriteType = spriteData.type;
        mesh.userData.animTime = 0;
        mesh.userData.frameIndex = 0;

        this.instances.push(mesh);

        return mesh;
    }

    /**
     * Update sprite orientations to face camera
     * @param {THREE.Camera} camera
     * @param {number} deltaTime
     */
    update(camera, deltaTime) {
        for (const sprite of this.instances) {
            if (!sprite.visible) continue;

            const spriteData = sprite.userData.spriteData;
            if (!spriteData) continue;

            // Update animation time
            sprite.userData.animTime += deltaTime;

            // Update frame if animated
            this.updateFrame(sprite);

            // Update orientation based on sprite type
            this.updateOrientation(sprite, camera);
        }
    }

    updateFrame(sprite) {
        const spriteData = sprite.userData.spriteData;
        const frame = spriteData.getFrame(sprite.userData.animTime, sprite.userData.frameIndex);

        // Get current texture
        let texInfo = spriteData.textures[sprite.userData.frameIndex];
        if (Array.isArray(texInfo)) {
            // Animated group - calculate which subframe
            const group = spriteData.frames[sprite.userData.frameIndex];
            const totalDuration = group.intervals.reduce((a, b) => a + b, 0);
            const loopTime = sprite.userData.animTime % totalDuration;

            let elapsed = 0;
            for (let i = 0; i < group.numFrames; i++) {
                elapsed += group.intervals[i];
                if (loopTime < elapsed) {
                    texInfo = texInfo[i];
                    break;
                }
            }
        }

        if (texInfo && sprite.material.map !== texInfo.texture) {
            sprite.material.map = texInfo.texture;
            sprite.material.needsUpdate = true;
        }
    }

    updateOrientation(sprite, camera) {
        const type = sprite.userData.spriteType;

        switch (type) {
            case SPR_TYPE.VP_PARALLEL:
                // Always face camera (full billboard)
                sprite.quaternion.copy(camera.quaternion);
                break;

            case SPR_TYPE.FACING_UPRIGHT:
            case SPR_TYPE.VP_PARALLEL_UPRIGHT:
                // Face camera but stay vertical
                const cameraPos = camera.position;
                const spritePos = sprite.position;

                // Calculate angle in XY plane only
                const dx = cameraPos.x - spritePos.x;
                const dy = cameraPos.y - spritePos.y;
                const angle = Math.atan2(dy, dx) - Math.PI / 2;

                sprite.rotation.set(0, 0, angle);
                break;

            case SPR_TYPE.ORIENTED:
                // Fixed orientation - don't modify
                break;

            case SPR_TYPE.VP_PARALLEL_ORIENTED:
                // Hybrid - use stored angle plus camera facing
                // Not commonly used, treat as parallel for now
                sprite.quaternion.copy(camera.quaternion);
                break;
        }
    }

    /**
     * Remove a sprite instance
     * @param {THREE.Mesh} sprite
     */
    removeInstance(sprite) {
        const index = this.instances.indexOf(sprite);
        if (index !== -1) {
            this.instances.splice(index, 1);
        }

        if (sprite.geometry) sprite.geometry.dispose();
        if (sprite.material) {
            if (sprite.material.map) sprite.material.map.dispose();
            sprite.material.dispose();
        }
    }

    /**
     * Clear all cached sprites
     */
    clear() {
        // Clear instances
        for (const sprite of this.instances) {
            if (sprite.geometry) sprite.geometry.dispose();
            if (sprite.material) {
                if (sprite.material.map) sprite.material.map.dispose();
                sprite.material.dispose();
            }
        }
        this.instances = [];

        // Clear cache
        for (const [name, spr] of this.cache) {
            for (const texInfo of spr.textures) {
                if (Array.isArray(texInfo)) {
                    for (const t of texInfo) {
                        t.texture.dispose();
                    }
                } else {
                    texInfo.texture.dispose();
                }
            }
        }
        this.cache.clear();
    }
}

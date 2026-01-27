import * as THREE from 'three';

/**
 * DebugOverlay - Shows entity names and states in 3D space
 * Toggle with Tab key
 */
export class DebugOverlay {
    constructor(game) {
        this.game = game;
        this.enabled = false;
        this.container = null;
        this.labels = new Map(); // entity id -> label element

        this.createContainer();
        this.setupKeyListener();
    }

    createContainer() {
        this.container = document.createElement('div');
        this.container.id = 'debug-overlay';
        this.container.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 1000;
            display: none;
            font-family: monospace;
            font-size: 12px;
        `;
        document.body.appendChild(this.container);

        // Add debug info panel
        this.infoPanel = document.createElement('div');
        this.infoPanel.style.cssText = `
            position: fixed;
            top: 10px;
            left: 10px;
            background: rgba(0, 0, 0, 0.8);
            color: #0f0;
            padding: 10px;
            border: 1px solid #0f0;
            max-height: 300px;
            overflow-y: auto;
            pointer-events: auto;
        `;
        this.container.appendChild(this.infoPanel);
    }

    setupKeyListener() {
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Tab') {
                e.preventDefault();
                this.toggle();
            }
        });
    }

    toggle() {
        this.enabled = !this.enabled;
        this.container.style.display = this.enabled ? 'block' : 'none';
        console.log(`Debug overlay: ${this.enabled ? 'ON' : 'OFF'}`);

        if (!this.enabled) {
            // Clear labels when disabled
            this.labels.forEach(label => label.remove());
            this.labels.clear();
        }
    }

    update() {
        if (!this.enabled || !this.game.player || !this.game.renderer) return;

        const camera = this.game.renderer.camera;
        if (!camera) return;

        const player = this.game.player;
        const playerPos = player.position;

        // Update info panel
        this.updateInfoPanel();

        // Update entity labels
        this.updateEntityLabels(camera, playerPos);
    }

    updateInfoPanel() {
        const player = this.game.player;
        const funcs = this.game.entities.funcs;
        const triggers = this.game.entities.triggers;
        const monsters = this.game.entities.monsters || [];
        const items = this.game.entities.items || [];

        const hull = player.hull || { mins: { z: -24 }, maxs: { z: 32 } };
        const eyeHeight = 22;
        const feetZ = player.position.z + hull.mins.z;
        const eyeZ = player.position.z + eyeHeight;
        const headZ = player.position.z + hull.maxs.z;

        // Get level info
        const mapName = this.game.currentMap || 'unknown';
        const levelName = this.game.stats?.levelName || mapName;

        // Get current BSP leaf
        let leafIndex = -1;
        if (this.game.renderer?.bspRenderer) {
            leafIndex = this.game.renderer.bspRenderer.getLeafForPoint(player.position);
        }

        let html = `<div style="color: #ff0; margin-bottom: 10px;">DEBUG MODE (Tab to toggle)</div>`;
        html += `<div style="color: #0ff;">Level: ${levelName} (${mapName})</div>`;
        html += `<div style="color: #0ff;">BSP Leaf: ${leafIndex}</div>`;
        html += `<hr style="border-color: #0f0; margin: 5px 0;">`;
        html += `<div>Player pos: ${player.position.x.toFixed(0)}, ${player.position.y.toFixed(0)}, ${player.position.z.toFixed(0)}</div>`;
        html += `<div>Feet: ${feetZ.toFixed(0)} | Eye: ${eyeZ.toFixed(0)} | Head: ${headZ.toFixed(0)}</div>`;
        html += `<div>Hull: ${hull.maxs.z - hull.mins.z} units tall (mins.z=${hull.mins.z}, maxs.z=${hull.maxs.z})</div>`;
        html += `<div>Funcs: ${funcs.length} | Triggers: ${triggers.length} | Monsters: ${monsters.length} | Items: ${items.length}</div>`;
        html += `<hr style="border-color: #0f0; margin: 5px 0;">`;

        // Show nearby entities
        html += `<div style="color: #ff0;">Nearby Entities:</div>`;

        const nearby = [];

        for (const func of funcs) {
            if (!func.active) continue;
            const dx = func.position.x - player.position.x;
            const dy = func.position.y - player.position.y;
            const dz = func.position.z - player.position.z;
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

            if (dist < 500) {
                nearby.push({ entity: func, dist, type: 'func' });
            }
        }

        for (const trigger of triggers) {
            if (!trigger.active) continue;
            // Triggers use hull center
            const cx = trigger.hull ? (trigger.hull.mins.x + trigger.hull.maxs.x) / 2 : 0;
            const cy = trigger.hull ? (trigger.hull.mins.y + trigger.hull.maxs.y) / 2 : 0;
            const cz = trigger.hull ? (trigger.hull.mins.z + trigger.hull.maxs.z) / 2 : 0;
            const dx = cx - player.position.x;
            const dy = cy - player.position.y;
            const dz = cz - player.position.z;
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

            if (dist < 500) {
                nearby.push({ entity: trigger, dist, type: 'trigger' });
            }
        }

        for (const monster of monsters) {
            if (!monster.active) continue;
            const pos = monster.position || { x: 0, y: 0, z: 0 };
            const dx = pos.x - player.position.x;
            const dy = pos.y - player.position.y;
            const dz = pos.z - player.position.z;
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

            if (dist < 500) {
                nearby.push({ entity: monster, dist, type: 'monster' });
            }
        }

        for (const item of items) {
            if (!item.active) continue;
            const pos = item.position || { x: 0, y: 0, z: 0 };
            const dx = pos.x - player.position.x;
            const dy = pos.y - player.position.y;
            const dz = pos.z - player.position.z;
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

            if (dist < 500) {
                nearby.push({ entity: item, dist, type: 'item' });
            }
        }

        nearby.sort((a, b) => a.dist - b.dist);

        for (const item of nearby.slice(0, 15)) {
            const e = item.entity;
            const state = e.data?.state || e.state || '';
            const health = e.health !== undefined ? `HP:${e.health}` : '';
            const target = e.target || '';
            const targetname = e.targetname || '';
            const modelIndex = e.data?.modelIndex !== undefined ? `*${e.data.modelIndex}` : '';
            const solidType = e.solid === 'not' ? '[no-solid]' : '';

            // Color by type
            let color;
            switch (item.type) {
                case 'func': color = '#0ff'; break;
                case 'trigger': color = '#f0f'; break;
                case 'monster': color = '#f00'; break;
                case 'item': color = '#0f0'; break;
                default: color = '#fff';
            }

            html += `<div style="color: ${color}; margin-left: 10px;">`;
            html += `${e.classname}`;
            if (modelIndex) html += ` ${modelIndex}`;
            if (solidType) html += ` <span style="color: #888;">${solidType}</span>`;
            if (targetname) html += ` [${targetname}]`;
            if (target) html += ` → ${target}`;
            if (health) html += ` ${health}`;
            if (state) html += ` (${state})`;
            html += ` <span style="color: #888;">${item.dist.toFixed(0)}u</span>`;
            html += `</div>`;
        }

        this.infoPanel.innerHTML = html;
    }

    updateEntityLabels(camera, playerPos) {
        const funcs = this.game.entities.funcs;
        const triggers = this.game.entities.triggers;
        const monsters = this.game.entities.monsters || [];
        const items = this.game.entities.items || [];
        const maxDist = 800;

        // Process func entities
        for (const func of funcs) {
            if (!func.active) continue;
            this.updateLabel(func, camera, playerPos, maxDist, '#0ff');
        }

        // Process trigger entities
        for (const trigger of triggers) {
            if (!trigger.active) continue;
            // Use hull center for triggers
            const pos = trigger.hull ? {
                x: (trigger.hull.mins.x + trigger.hull.maxs.x) / 2,
                y: (trigger.hull.mins.y + trigger.hull.maxs.y) / 2,
                z: (trigger.hull.mins.z + trigger.hull.maxs.z) / 2
            } : trigger.position;
            this.updateLabelAtPos(trigger, pos, camera, playerPos, maxDist, '#f0f');
        }

        // Process monster entities
        for (const monster of monsters) {
            if (!monster.active) continue;
            this.updateLabel(monster, camera, playerPos, maxDist, '#f00', true);
        }

        // Process item entities
        for (const item of items) {
            if (!item.active) continue;
            this.updateLabel(item, camera, playerPos, maxDist, '#0f0');
        }

        // Remove labels for entities that are gone
        for (const [id, label] of this.labels) {
            const entity = this.game.entities.entities[id];
            if (!entity || !entity.active) {
                label.remove();
                this.labels.delete(id);
            }
        }
    }

    updateLabel(entity, camera, playerPos, maxDist, color, showHealth = false) {
        // Get entity center position
        let pos;
        if (entity.hull) {
            pos = {
                x: entity.position.x + (entity.hull.mins.x + entity.hull.maxs.x) / 2,
                y: entity.position.y + (entity.hull.mins.y + entity.hull.maxs.y) / 2,
                z: entity.position.z + entity.hull.maxs.z + 20 // Above the entity
            };
        } else {
            pos = { ...entity.position, z: entity.position.z + 40 };
        }

        this.updateLabelAtPos(entity, pos, camera, playerPos, maxDist, color, showHealth);
    }

    updateLabelAtPos(entity, pos, camera, playerPos, maxDist, color, showHealth = false) {
        const dx = pos.x - playerPos.x;
        const dy = pos.y - playerPos.y;
        const dz = pos.z - playerPos.z;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

        if (dist > maxDist) {
            // Too far, remove label if exists
            if (this.labels.has(entity.id)) {
                this.labels.get(entity.id).remove();
                this.labels.delete(entity.id);
            }
            return;
        }

        // Project to screen
        const screenPos = this.worldToScreen(pos, camera);
        if (!screenPos) {
            // Behind camera
            if (this.labels.has(entity.id)) {
                this.labels.get(entity.id).style.display = 'none';
            }
            return;
        }

        // Get or create label
        let label = this.labels.get(entity.id);
        if (!label) {
            label = document.createElement('div');
            label.style.cssText = `
                position: fixed;
                transform: translate(-50%, -100%);
                background: rgba(0, 0, 0, 0.7);
                padding: 2px 6px;
                border: 1px solid ${color};
                color: ${color};
                white-space: nowrap;
                text-shadow: 1px 1px 0 #000;
            `;
            this.container.appendChild(label);
            this.labels.set(entity.id, label);
        }

        // Update label content
        let text = entity.classname;
        if (entity.targetname) text += `\n[${entity.targetname}]`;
        if (entity.target) text += `\n→ ${entity.target}`;
        if (showHealth && entity.health !== undefined) text += `\nHP: ${entity.health}`;
        if (entity.data?.state !== undefined) text += `\n(${entity.data.state})`;
        else if (entity.state !== undefined) text += `\n(${entity.state})`;

        label.innerText = text;
        label.style.display = 'block';
        label.style.left = `${screenPos.x}px`;
        label.style.top = `${screenPos.y}px`;

        // Fade based on distance
        const alpha = Math.max(0.3, 1 - dist / maxDist);
        label.style.opacity = alpha;
    }

    worldToScreen(worldPos, camera) {
        // Create a vector for the position (Quake coords used directly)
        const vec = new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z);

        // Project to NDC
        vec.project(camera);

        // Check if behind camera
        if (vec.z > 1) return null;

        // Convert to screen coordinates
        const width = window.innerWidth;
        const height = window.innerHeight;

        return {
            x: (vec.x * 0.5 + 0.5) * width,
            y: (-vec.y * 0.5 + 0.5) * height
        };
    }

    destroy() {
        if (this.container) {
            this.container.remove();
        }
    }
}

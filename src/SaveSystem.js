/**
 * SaveSystem - Game state persistence using localStorage
 *
 * Original Quake save format was binary, this uses JSON for simplicity.
 * Saves player state, current map, and some game progress.
 */

const SAVE_VERSION = 1;
const SAVE_KEY_PREFIX = 'quake_save_';
const MAX_SAVE_SLOTS = 8;

export class SaveSystem {
    constructor(game) {
        this.game = game;
    }

    /**
     * Save current game state to a slot
     * @param {number} slot - Save slot (0-7)
     * @param {string} name - Optional save name
     * @returns {boolean} Success
     */
    save(slot = 0, name = '') {
        if (slot < 0 || slot >= MAX_SAVE_SLOTS) {
            console.error('Invalid save slot');
            return false;
        }

        const player = this.game.player;
        if (!player) {
            console.error('No player to save');
            return false;
        }

        const saveData = {
            version: SAVE_VERSION,
            name: name || `Save ${slot + 1}`,
            timestamp: Date.now(),

            // Map info
            map: this.game.currentMap || 'start',
            skill: this.game.skill,
            time: this.game.time,

            // Player state
            player: {
                position: { ...player.position },
                angles: { ...player.angles },
                velocity: { ...player.velocity },

                health: player.health,
                maxHealth: player.maxHealth,
                armor: player.armor,
                armorType: player.armorType,

                items: player.items,
                weapons: player.weapons,
                currentWeapon: player.currentWeapon,
                ammo: { ...player.ammo },

                // Powerup timers
                quadTime: player.quadTime,
                invincibleTime: player.invincibleTime,
                invisibleTime: player.invisibleTime,
                suitTime: player.suitTime
            },

            // Level progress
            stats: {
                kills: this.game.stats?.kills || 0,
                totalKills: this.game.stats?.totalKills || 0,
                secrets: this.game.stats?.secrets || 0,
                totalSecrets: this.game.stats?.totalSecrets || 0
            }
        };

        try {
            const key = SAVE_KEY_PREFIX + slot;
            localStorage.setItem(key, JSON.stringify(saveData));
            console.log(`Game saved to slot ${slot}: ${saveData.name}`);
            return true;
        } catch (e) {
            console.error('Failed to save game:', e);
            return false;
        }
    }

    /**
     * Load game state from a slot
     * @param {number} slot - Save slot (0-7)
     * @returns {boolean} Success
     */
    async load(slot = 0) {
        if (slot < 0 || slot >= MAX_SAVE_SLOTS) {
            console.error('Invalid save slot');
            return false;
        }

        const key = SAVE_KEY_PREFIX + slot;
        const json = localStorage.getItem(key);

        if (!json) {
            console.error('No save in slot', slot);
            return false;
        }

        let saveData;
        try {
            saveData = JSON.parse(json);
        } catch (e) {
            console.error('Failed to parse save data:', e);
            return false;
        }

        if (saveData.version !== SAVE_VERSION) {
            console.warn('Save version mismatch, may have issues');
        }

        // Load the map
        try {
            await this.game.loadLevel(saveData.map);
        } catch (e) {
            console.error('Failed to load map:', e);
            return false;
        }

        // Restore player state
        const player = this.game.player;
        if (player && saveData.player) {
            const p = saveData.player;

            player.position = { ...p.position };
            player.angles = { ...p.angles };
            player.velocity = { ...p.velocity };

            player.health = p.health;
            player.maxHealth = p.maxHealth;
            player.armor = p.armor;
            player.armorType = p.armorType;

            player.items = p.items;
            player.weapons = p.weapons;
            player.currentWeapon = p.currentWeapon;
            player.ammo = { ...p.ammo };

            player.quadTime = p.quadTime || 0;
            player.invincibleTime = p.invincibleTime || 0;
            player.invisibleTime = p.invisibleTime || 0;
            player.suitTime = p.suitTime || 0;
        }

        // Restore game state
        this.game.skill = saveData.skill || 1;
        this.game.time = saveData.time || 0;

        // Restore stats
        if (saveData.stats) {
            this.game.stats = {
                ...this.game.stats,
                kills: saveData.stats.kills,
                secrets: saveData.stats.secrets
            };
        }

        console.log(`Game loaded from slot ${slot}: ${saveData.name}`);
        return true;
    }

    /**
     * Get info about a save slot without loading
     * @param {number} slot - Save slot
     * @returns {Object|null} Save info or null if empty
     */
    getSaveInfo(slot) {
        if (slot < 0 || slot >= MAX_SAVE_SLOTS) {
            return null;
        }

        const key = SAVE_KEY_PREFIX + slot;
        const json = localStorage.getItem(key);

        if (!json) {
            return null;
        }

        try {
            const saveData = JSON.parse(json);
            return {
                slot,
                name: saveData.name,
                map: saveData.map,
                timestamp: saveData.timestamp,
                skill: saveData.skill,
                health: saveData.player?.health,
                armor: saveData.player?.armor
            };
        } catch (e) {
            return null;
        }
    }

    /**
     * Get list of all save slots with info
     * @returns {Array} Array of save info objects
     */
    getAllSaves() {
        const saves = [];
        for (let i = 0; i < MAX_SAVE_SLOTS; i++) {
            const info = this.getSaveInfo(i);
            saves.push(info || { slot: i, empty: true });
        }
        return saves;
    }

    /**
     * Delete a save slot
     * @param {number} slot - Save slot
     */
    deleteSave(slot) {
        if (slot < 0 || slot >= MAX_SAVE_SLOTS) {
            return false;
        }

        const key = SAVE_KEY_PREFIX + slot;
        localStorage.removeItem(key);
        console.log(`Deleted save slot ${slot}`);
        return true;
    }

    /**
     * Quick save to slot 0
     */
    quickSave() {
        return this.save(0, 'Quick Save');
    }

    /**
     * Quick load from slot 0
     */
    async quickLoad() {
        return this.load(0);
    }
}

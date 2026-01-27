/**
 * AudioManager - Web Audio API sound system
 *
 * Handles:
 * - Point sounds (3D positioned)
 * - Ambient loops (environmental)
 * - Local sounds (weapons, UI)
 *
 * Original Quake audio constants (snd_dma.c):
 * - MAX_CHANNELS = 128
 * - MAX_DYNAMIC_CHANNELS = 8
 * - NUM_AMBIENTS = 4
 * - sound_nominal_clip_dist = 1000.0
 * - Linear attenuation: scale = (1.0 - dist) where dist = distance * attenuation / 1000
 *
 * Channel priority (SND_PickChannel in snd_dma.c:354-391):
 * 1. Override same entity/channel sounds
 * 2. Don't let monster sounds override player sounds
 * 3. Pick channel with least time remaining
 */

// Original Quake channel limits
const MAX_CHANNELS = 128;
const MAX_DYNAMIC_CHANNELS = 8;
const NUM_AMBIENTS = 4;
const SOUND_NOMINAL_CLIP_DIST = 1000.0;

// Ambient sound types (from snd_dma.c)
// These correspond to BSP leaf ambient_level indices
const AMBIENT_WATER = 0;
const AMBIENT_SKY = 1;
const AMBIENT_SLIME = 2;
const AMBIENT_LAVA = 3;

// Ambient sound file paths (from snd_dma.c:94-97)
const AMBIENT_SOUNDS = [
    'sound/ambience/water1.wav',  // AMBIENT_WATER
    'sound/ambience/wind2.wav',   // AMBIENT_SKY
    'sound/ambience/water1.wav',  // AMBIENT_SLIME (uses water sound)
    'sound/ambience/fire1.wav'    // AMBIENT_LAVA
];

// Ambient fade rate (snd_dma.c:638) - 100 units per second
const AMBIENT_FADE = 100;

export class AudioManager {
    constructor() {
        this.context = null;
        this.masterGain = null;
        this.listener = null;

        this.sounds = new Map();
        this.ambientSounds = [];

        // Player entity number for priority protection (set by game)
        this.viewEntityNum = 1;

        this.initialized = false;
        this.muted = false;
        this.volume = 0.7;

        // Ambient sound channels (first NUM_AMBIENTS slots reserved)
        // These are managed separately from regular sound channels
        this.ambientChannels = new Array(NUM_AMBIENTS).fill(null);
        this.ambientVolumes = new Array(NUM_AMBIENTS).fill(0);  // Current volume levels
        this.ambientLevel = 0.3;  // ambient_level cvar (0-1 scale)
        this.ambientEnabled = true;

        // Pre-initialize activeSounds with ambient slots reserved
        // This ensures dynamic sounds start at index NUM_AMBIENTS, not 0
        this.activeSounds = new Array(NUM_AMBIENTS).fill(null);
    }

    /**
     * Set the player's entity number for sound priority protection
     * Player sounds won't be overridden by monster sounds
     */
    setViewEntity(entnum) {
        this.viewEntityNum = entnum;
    }

    async init() {
        if (this.initialized) return;

        try {
            this.context = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.context.createGain();
            this.masterGain.connect(this.context.destination);
            this.masterGain.gain.value = this.volume;

            this.listener = this.context.listener;

            this.initialized = true;
            console.log('Audio initialized');
        } catch (error) {
            console.error('Failed to initialize audio:', error);
        }
    }

    async resume() {
        if (this.context && this.context.state === 'suspended') {
            await this.context.resume();
        }
    }

    async loadSound(name, arrayBuffer) {
        if (!this.initialized) await this.init();

        try {
            const audioBuffer = await this.context.decodeAudioData(arrayBuffer.slice(0));
            this.sounds.set(name, audioBuffer);
            return audioBuffer;
        } catch (error) {
            console.error(`Failed to load sound ${name}:`, error);
            return null;
        }
    }

    async loadSoundFromPAK(pak, path) {
        const data = pak.get(path);
        if (!data) {
            console.warn(`Sound not found: ${path}`);
            return null;
        }

        // WAV files in Quake PAK are standard WAV format
        return this.loadSound(path, data);
    }

    /**
     * Pick a channel for a new sound, using original Quake priority logic
     * (SND_PickChannel from snd_dma.c:354-391)
     *
     * @param {number} entnum - Entity number playing the sound
     * @param {number} entchannel - Sound channel (0 = never override, -1 = override any)
     * @returns {number} Index to use, or -1 if no channel available
     */
    pickChannel(entnum, entchannel) {
        let firstToDie = -1;
        let leastTimeRemaining = Infinity;
        const now = this.context ? this.context.currentTime : 0;

        // Only check dynamic channels (skip ambient slots)
        const startIdx = NUM_AMBIENTS;
        const maxIdx = NUM_AMBIENTS + MAX_DYNAMIC_CHANNELS;
        const endIdx = Math.min(this.activeSounds.length, maxIdx);

        for (let i = startIdx; i < endIdx; i++) {
            const channel = this.activeSounds[i];

            // Empty/finished slot - use it immediately
            // Original Quake: finished sounds have negative life_left and are picked first
            if (!channel) {
                return i;
            }

            // Channel 0 never overrides existing sounds from same entity
            // entchannel -1 overrides any channel from same entity
            if (entchannel !== 0 &&
                channel.entnum === entnum &&
                (channel.entchannel === entchannel || entchannel === -1)) {
                // Always override sound from same entity/channel
                return i;
            }

            // Don't let monster sounds override player sounds
            if (channel.entnum === this.viewEntityNum &&
                entnum !== this.viewEntityNum &&
                channel.source) {
                continue;
            }

            // Track channel with least time remaining
            const timeRemaining = channel.loop ? Infinity :
                (channel.startTime + (channel.source?.buffer?.duration || 0)) - now;

            if (timeRemaining < leastTimeRemaining) {
                leastTimeRemaining = timeRemaining;
                firstToDie = i;
            }
        }

        // If we haven't filled all dynamic slots yet, use a new one
        if (firstToDie === -1 && endIdx < maxIdx) {
            // Extend array to the new slot
            while (this.activeSounds.length <= endIdx) {
                this.activeSounds.push(null);
            }
            return endIdx;
        }

        return firstToDie;
    }

    playSound(name, options = {}) {
        if (!this.initialized || this.muted) return null;

        const buffer = this.sounds.get(name);
        if (!buffer) {
            console.warn(`Sound not loaded: ${name}`);
            return null;
        }

        const {
            position = null,
            volume = 1.0,
            pitch = 1.0,
            loop = false,
            attenuation = 1.0,
            entnum = 0,       // Entity number playing this sound
            entchannel = 0    // Sound channel (0 = auto, -1 = override any from entity)
        } = options;

        // Use Quake-style channel selection with priority
        const channelIdx = this.pickChannel(entnum, entchannel);
        if (channelIdx === -1) {
            // No available channel (all protected player sounds)
            return null;
        }

        // Stop existing sound in this channel if any
        if (channelIdx < this.activeSounds.length && this.activeSounds[channelIdx]) {
            this.stopSound(this.activeSounds[channelIdx]);
        }

        // Create source
        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = pitch;
        source.loop = loop;

        // Create gain for volume control
        const gainNode = this.context.createGain();
        gainNode.gain.value = volume;

        if (position) {
            // 3D positioned sound with original Quake spatialization (snd_dma.c:419-444)
            // Original formula: dist = distance * (attenuation / sound_nominal_clip_dist)
            //                   scale = (1.0 - dist) * stereo_scale
            // This is LINEAR attenuation from full volume at distance 0 to
            // silence at distance = sound_nominal_clip_dist / attenuation
            const panner = this.context.createPanner();
            panner.panningModel = 'HRTF';

            // Use 'linear' distance model to match original Quake
            // Linear formula: attenuation = max((1 - rolloff * (d - ref) / (max - ref)), 0)
            // With ref=1, max=clipDist, rolloff=1: matches Quake's (1 - dist/clipDist)
            panner.distanceModel = 'linear';
            panner.refDistance = 1;
            panner.maxDistance = SOUND_NOMINAL_CLIP_DIST / attenuation;
            panner.rolloffFactor = 1;

            panner.positionX.value = position.x;
            panner.positionY.value = position.y;
            panner.positionZ.value = position.z;

            source.connect(gainNode);
            gainNode.connect(panner);
            panner.connect(this.masterGain);
        } else {
            // 2D sound (view entity sounds are always full volume in original)
            source.connect(gainNode);
            gainNode.connect(this.masterGain);
        }

        source.start(0);

        const soundInstance = {
            source,
            gainNode,
            name,
            position,
            startTime: this.context.currentTime,
            loop,
            entnum,      // Entity number for priority checks
            entchannel   // Sound channel for override logic
        };

        // Insert at the chosen channel index
        if (channelIdx >= this.activeSounds.length) {
            this.activeSounds.push(soundInstance);
        } else {
            this.activeSounds[channelIdx] = soundInstance;
        }

        // Clean up when finished - set slot to null to preserve channel indices
        source.onended = () => {
            const index = this.activeSounds.indexOf(soundInstance);
            if (index >= 0) {
                this.activeSounds[index] = null;
            }
        };

        return soundInstance;
    }

    playLocal(name, volume = 1.0, entnum = 0, entchannel = 0) {
        // Local sounds from view entity get protected
        return this.playSound(name, {
            volume,
            entnum: entnum || this.viewEntityNum,
            entchannel
        });
    }

    playPositioned(name, position, volume = 1.0, attenuation = 1.0, loop = false, entnum = 0, entchannel = 0) {
        return this.playSound(name, { position, volume, attenuation, loop, entnum, entchannel });
    }

    playAmbient(name, position, volume = 0.5) {
        // Original Quake ambient sounds (snd_dma.c:650):
        // dist_mult = (attenuation/64) / sound_nominal_clip_dist
        // This means ambient sounds fade out at 64x the normal distance
        // Use low attenuation value to achieve this effect
        const instance = this.playSound(name, {
            position,
            volume,
            loop: true,
            attenuation: 1.0 / 64.0  // Very gradual falloff for ambients
        });

        if (instance) {
            this.ambientSounds.push(instance);
        }

        return instance;
    }

    stopSound(instance) {
        if (instance && instance.source) {
            try {
                instance.source.stop();
            } catch (e) {
                // Already stopped
            }
        }
    }

    stopAllSounds() {
        for (const instance of this.activeSounds) {
            if (instance) {
                this.stopSound(instance);
            }
        }
        // Reset with ambient slots reserved (indices 0-3)
        this.activeSounds = new Array(NUM_AMBIENTS).fill(null);
        this.ambientSounds = [];

        // Also stop ambient sounds
        this.stopAmbientSounds();
    }

    updateListener(position, forward, up) {
        if (!this.listener) return;

        // Set listener position
        if (this.listener.positionX) {
            // Modern API
            this.listener.positionX.value = position.x;
            this.listener.positionY.value = position.y;
            this.listener.positionZ.value = position.z;

            this.listener.forwardX.value = forward.x;
            this.listener.forwardY.value = forward.y;
            this.listener.forwardZ.value = forward.z;

            this.listener.upX.value = up.x;
            this.listener.upY.value = up.y;
            this.listener.upZ.value = up.z;
        } else {
            // Legacy API
            this.listener.setPosition(position.x, position.y, position.z);
            this.listener.setOrientation(
                forward.x, forward.y, forward.z,
                up.x, up.y, up.z
            );
        }
    }

    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
        if (this.masterGain) {
            this.masterGain.gain.value = this.muted ? 0 : this.volume;
        }
    }

    /**
     * Load ambient sound files from PAK
     * Must be called after init() and before updateAmbientSounds()
     */
    async loadAmbientSounds(pak) {
        for (let i = 0; i < NUM_AMBIENTS; i++) {
            const path = AMBIENT_SOUNDS[i];
            const data = pak.get(path);
            if (data) {
                await this.loadSound(path, data);
                console.log(`Loaded ambient sound: ${path}`);
            } else {
                console.warn(`Ambient sound not found: ${path}`);
            }
        }
    }

    /**
     * Update ambient sounds based on current BSP leaf
     * Original: S_UpdateAmbientSounds from snd_dma.c:619-670
     *
     * The ambient level for each sound type is stored in each BSP leaf.
     * As the player moves, ambient sounds fade towards the target level.
     *
     * @param {number[]} ambientLevels - Array of 4 ambient levels (0-255) from current leaf
     * @param {number} deltaTime - Time since last frame in seconds
     */
    updateAmbientSounds(ambientLevels, deltaTime) {
        if (!this.initialized || !this.ambientEnabled) return;

        for (let i = 0; i < NUM_AMBIENTS; i++) {
            // Get target volume (0-255 scale -> 0-1 scale)
            // Original: vol = ambient_level.value * l->ambient_sound_level[ambient]
            const targetLevel = ambientLevels ?
                (ambientLevels[i] / 255) * this.ambientLevel :
                0;

            // Fade towards target (original: ambient_fade = 100 units/sec)
            // Volume is 0-255 in original, but we use 0-1
            // Fade rate: 100/255 ≈ 0.39 per second in our scale
            const fadeAmount = (AMBIENT_FADE / 255) * deltaTime;

            if (this.ambientVolumes[i] < targetLevel) {
                this.ambientVolumes[i] += fadeAmount;
                if (this.ambientVolumes[i] > targetLevel) {
                    this.ambientVolumes[i] = targetLevel;
                }
            } else if (this.ambientVolumes[i] > targetLevel) {
                this.ambientVolumes[i] -= fadeAmount;
                if (this.ambientVolumes[i] < targetLevel) {
                    this.ambientVolumes[i] = targetLevel;
                }
            }

            // Don't play if too quiet
            const vol = this.ambientVolumes[i];
            if (vol < 0.001) {
                // Stop channel if playing
                if (this.ambientChannels[i]) {
                    this.stopSound(this.ambientChannels[i]);
                    this.ambientChannels[i] = null;
                }
                continue;
            }

            // Start or update ambient sound
            if (!this.ambientChannels[i]) {
                // Start playing the ambient loop
                const buffer = this.sounds.get(AMBIENT_SOUNDS[i]);
                if (!buffer) continue;

                const source = this.context.createBufferSource();
                source.buffer = buffer;
                source.loop = true;

                const gainNode = this.context.createGain();
                gainNode.gain.value = vol;

                source.connect(gainNode);
                gainNode.connect(this.masterGain);
                source.start(0);

                this.ambientChannels[i] = {
                    source,
                    gainNode,
                    name: AMBIENT_SOUNDS[i],
                    loop: true
                };
            } else {
                // Update volume on existing channel
                this.ambientChannels[i].gainNode.gain.value = vol;
            }
        }
    }

    /**
     * Stop all ambient sounds (e.g., when changing maps)
     */
    stopAmbientSounds() {
        for (let i = 0; i < NUM_AMBIENTS; i++) {
            if (this.ambientChannels[i]) {
                this.stopSound(this.ambientChannels[i]);
                this.ambientChannels[i] = null;
            }
            this.ambientVolumes[i] = 0;
        }
    }

    /**
     * Set ambient sound volume (ambient_level cvar)
     * @param {number} level - Volume scale 0-1
     */
    setAmbientLevel(level) {
        this.ambientLevel = Math.max(0, Math.min(1, level));
    }

    setMuted(muted) {
        this.muted = muted;
        if (this.masterGain) {
            this.masterGain.gain.value = muted ? 0 : this.volume;
        }
    }

    toggleMute() {
        this.setMuted(!this.muted);
    }
}

/**
 * Parse WAV file from ArrayBuffer
 * Quake uses standard PCM WAV files
 */
export function parseWAV(arrayBuffer) {
    const view = new DataView(arrayBuffer);

    // Check RIFF header
    const riff = String.fromCharCode(
        view.getUint8(0),
        view.getUint8(1),
        view.getUint8(2),
        view.getUint8(3)
    );

    if (riff !== 'RIFF') {
        throw new Error('Invalid WAV file: missing RIFF header');
    }

    // Check WAVE format
    const wave = String.fromCharCode(
        view.getUint8(8),
        view.getUint8(9),
        view.getUint8(10),
        view.getUint8(11)
    );

    if (wave !== 'WAVE') {
        throw new Error('Invalid WAV file: missing WAVE format');
    }

    return {
        // WAV is already in a format Web Audio can decode
        buffer: arrayBuffer
    };
}

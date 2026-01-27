/**
 * MusicManager - Background music playback
 *
 * Original Quake used CD audio tracks:
 * - Track 1: Data (no audio)
 * - Track 2-11: Music tracks
 *
 * Worldspawn entity has 'sounds' field with track number
 * For browser, expects audio files in music/ folder:
 * - music/track02.ogg (or .mp3)
 * - music/track03.ogg
 * - etc.
 */

export class MusicManager {
    constructor() {
        this.currentTrack = null;
        this.audio = null;
        this.volume = 0.5;
        this.enabled = true;
        this.basePath = 'music/';
    }

    /**
     * Set the base path for music files
     * @param {string} path - Base path (e.g., 'music/')
     */
    setBasePath(path) {
        this.basePath = path;
    }

    /**
     * Play a specific CD track
     * @param {number} track - Track number (2-11 typically)
     */
    async play(track) {
        if (!this.enabled) return;
        if (track === this.currentTrack && this.audio && !this.audio.paused) {
            return; // Already playing this track
        }

        // Stop current track
        this.stop();

        // Pad track number to 2 digits
        const trackNum = track.toString().padStart(2, '0');

        // Try different formats
        const formats = ['ogg', 'mp3', 'wav'];
        let loaded = false;

        for (const format of formats) {
            const url = `${this.basePath}track${trackNum}.${format}`;

            try {
                this.audio = new Audio(url);
                this.audio.volume = this.volume;
                this.audio.loop = true;

                // Wait for canplaythrough event
                await new Promise((resolve, reject) => {
                    this.audio.oncanplaythrough = resolve;
                    this.audio.onerror = reject;
                    this.audio.load();

                    // Timeout after 2 seconds
                    setTimeout(() => reject(new Error('Load timeout')), 2000);
                });

                await this.audio.play();
                this.currentTrack = track;
                loaded = true;
                console.log(`Playing music track ${trackNum} (${format})`);
                break;
            } catch (e) {
                // Try next format
            }
        }

        if (!loaded) {
            console.log(`Music track ${trackNum} not found`);
        }
    }

    /**
     * Stop current music
     */
    stop() {
        if (this.audio) {
            this.audio.pause();
            this.audio.currentTime = 0;
            this.audio = null;
        }
        this.currentTrack = null;
    }

    /**
     * Pause current music
     */
    pause() {
        if (this.audio) {
            this.audio.pause();
        }
    }

    /**
     * Resume paused music
     */
    resume() {
        if (this.audio && this.audio.paused) {
            this.audio.play().catch(() => {});
        }
    }

    /**
     * Set music volume
     * @param {number} volume - Volume 0.0 to 1.0
     */
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
        if (this.audio) {
            this.audio.volume = this.volume;
        }
    }

    /**
     * Enable/disable music
     * @param {boolean} enabled
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled) {
            this.stop();
        }
    }

    /**
     * Check if music is currently playing
     */
    isPlaying() {
        return this.audio && !this.audio.paused;
    }

    /**
     * Get current track number
     */
    getCurrentTrack() {
        return this.currentTrack;
    }
}

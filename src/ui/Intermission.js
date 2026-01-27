/**
 * Intermission - Level completion screen
 *
 * Original Quake shows:
 * - Level name
 * - Time taken (minutes:seconds)
 * - Secrets found / total secrets
 * - Monsters killed / total monsters
 *
 * Camera is positioned at info_intermission entity if present
 */

export class Intermission {
    constructor(container) {
        this.container = container;
        this.active = false;
        this.stats = null;

        // Create overlay element
        this.overlay = document.createElement('div');
        this.overlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.7);
            display: none;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            font-family: monospace;
            color: #b5a27c;
            pointer-events: auto;
            z-index: 100;
        `;

        // Stats container
        this.statsContainer = document.createElement('div');
        this.statsContainer.style.cssText = `
            text-align: center;
            font-size: 24px;
            line-height: 1.8;
        `;

        this.overlay.appendChild(this.statsContainer);
        container.appendChild(this.overlay);
    }

    /**
     * Show intermission screen with level stats
     * @param {Object} stats - Level statistics
     */
    show(stats) {
        this.active = true;
        this.stats = stats;

        const levelName = stats.levelName || 'Unknown Level';
        const timeMinutes = Math.floor(stats.time / 60);
        const timeSeconds = Math.floor(stats.time % 60);
        const timeStr = `${timeMinutes}:${timeSeconds.toString().padStart(2, '0')}`;

        const kills = stats.kills || 0;
        const totalKills = stats.totalKills || 0;
        const secrets = stats.secrets || 0;
        const totalSecrets = stats.totalSecrets || 0;

        this.statsContainer.innerHTML = `
            <div style="font-size: 32px; margin-bottom: 40px; color: #ff9900;">
                ${levelName}
            </div>
            <div style="margin-bottom: 20px;">
                <span style="color: #888;">Time:</span> ${timeStr}
            </div>
            <div style="margin-bottom: 20px;">
                <span style="color: #888;">Secrets:</span> ${secrets} / ${totalSecrets}
            </div>
            <div style="margin-bottom: 40px;">
                <span style="color: #888;">Kills:</span> ${kills} / ${totalKills}
            </div>
            <div style="font-size: 16px; color: #666;">
                Press any key to continue...
            </div>
        `;

        this.overlay.style.display = 'flex';

        // Setup key handler
        this.boundKeyHandler = this.handleKey.bind(this);
        document.addEventListener('keydown', this.boundKeyHandler);
        document.addEventListener('click', this.boundKeyHandler);
    }

    handleKey(event) {
        if (this.active && this.onContinue) {
            this.hide();
            this.onContinue();
        }
    }

    hide() {
        this.active = false;
        this.overlay.style.display = 'none';

        // Remove key handler
        if (this.boundKeyHandler) {
            document.removeEventListener('keydown', this.boundKeyHandler);
            document.removeEventListener('click', this.boundKeyHandler);
            this.boundKeyHandler = null;
        }
    }

    isActive() {
        return this.active;
    }

    destroy() {
        this.hide();
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
    }
}

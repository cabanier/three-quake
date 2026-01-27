import { QUAKE_PALETTE } from '../loaders/Palette.js';
import { setDeveloperMode } from '../system/Logger.js';
import {
    Cvar_RegisterVariable, Cvar_FindVar, Cvar_Set, Cvar_SetValue,
    Cvar_VariableValue, Cvar_VariableString, Cvar_Command, Cvar_List,
    Cvar_Toggle, Cvar_Reset, Cvar_ResetAll, Cvar_SaveConfig, Cvar_LoadConfig,
    Cvar_CompleteAll, CVar_SetCommandChecker,
    CVAR_ARCHIVE, CVAR_NOTIFY
} from '../system/CVar.js';

/**
 * Console - Quake drop-down console
 *
 * Original Quake console features:
 * - Drop-down animation (~ key to toggle)
 * - Scrollback buffer (CON_TEXTSIZE = 16384 chars)
 * - Command history (32 lines)
 * - Tab completion
 * - Notify lines (recent messages shown during gameplay)
 * - Command chaining with semicolons (cmd.c Cbuf_Execute)
 * - Quote-aware parsing (semicolons inside quotes are ignored)
 * - Wait command for frame delays
 */

const CON_TEXTSIZE = 16384;
const MAXCMDLINE = 256;
const HISTORY_SIZE = 32;
const NUM_CON_TIMES = 4;
const CMD_BUFFER_SIZE = 8192;

export class Console {
    constructor(container, pak) {
        this.pak = pak;
        this.container = container;

        // Create canvas overlay
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'console-canvas';
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.imageRendering = 'pixelated';
        this.canvas.style.zIndex = '200';
        this.canvas.style.display = 'none';
        this.canvas.style.pointerEvents = 'auto';  // Ensure it can receive events
        container.appendChild(this.canvas);

        this.ctx = this.canvas.getContext('2d');

        // Console text buffer (circular)
        this.text = new Array(CON_TEXTSIZE).fill(' ');
        this.lineWidth = 38;  // Characters per line (will be recalculated)
        this.totalLines = Math.floor(CON_TEXTSIZE / this.lineWidth);
        this.current = this.totalLines - 1;  // Current line being written
        this.x = 0;  // Position in current line
        this.backscroll = 0;  // Scroll offset

        // Input line
        this.inputLines = [];
        for (let i = 0; i < HISTORY_SIZE; i++) {
            this.inputLines.push(']');
        }
        this.editLine = 0;
        this.historyLine = 0;
        this.linePos = 1;  // Cursor position (after the ] prompt)

        // Notify times (for transparent overlay messages)
        this.notifyTimes = new Array(NUM_CON_TIMES).fill(0);
        this.notifyTimeout = 3;  // Seconds

        // Console state
        this.visible = false;
        this.visibleLines = 0;  // Current drop-down height in lines
        this.targetLines = 0;   // Target height (for animation)
        this.dropSpeed = 600;   // Pixels per second

        // Graphics
        this.conbackCanvas = null;
        this.charsetCanvas = null;
        this.loaded = false;

        // Timing
        this.time = 0;
        this.cursorSpeed = 4;  // Blinks per second

        // Commands registry
        this.commands = new Map();
        this.cvars = new Map();

        // Command buffer for chaining (like Quake's cmd_text)
        this.cmdBuffer = '';
        this.cmdWait = false;  // Set by 'wait' command to delay execution to next frame

        // Callbacks
        this.onCommand = null;  // Called when a command is executed
        this.onClose = null;    // Called when console is closed

        // Register built-in commands
        this.registerBuiltinCommands();

        // Input handling
        this.boundKeyDown = this.handleKeyDown.bind(this);
        document.addEventListener('keydown', this.boundKeyDown);
    }

    async init() {
        await this.loadGraphics();
    }

    async loadGraphics() {
        console.log('Console: Loading graphics...');

        // Load console background (gfx/conback.lmp)
        await this.loadConback();
        console.log('Console: conbackCanvas:', this.conbackCanvas ? 'loaded' : 'null');

        // Load charset (shared with menu)
        await this.loadCharset();
        console.log('Console: charsetCanvas:', this.charsetCanvas ? 'loaded' : 'null');

        this.loaded = true;
        console.log('Console: Graphics loaded, ready');
        this.print('Console initialized.\n');
    }

    async loadConback() {
        const data = this.pak.get('gfx/conback.lmp');
        if (!data) {
            console.warn('Console: conback.lmp not found');
            return;
        }

        // LMP format: width (uint32) + height (uint32) + pixel data
        const view = new DataView(data);
        const width = view.getUint32(0, true);
        const height = view.getUint32(4, true);

        const pixelData = new Uint8Array(data, 8, width * height);

        // Convert to RGBA
        const rgba = new Uint8Array(width * height * 4);
        for (let i = 0; i < pixelData.length; i++) {
            const palIdx = pixelData[i];
            const dstIdx = i * 4;
            rgba[dstIdx] = QUAKE_PALETTE[palIdx * 3];
            rgba[dstIdx + 1] = QUAKE_PALETTE[palIdx * 3 + 1];
            rgba[dstIdx + 2] = QUAKE_PALETTE[palIdx * 3 + 2];
            rgba[dstIdx + 3] = 255;
        }

        // Create canvas
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const imageData = new ImageData(new Uint8ClampedArray(rgba.buffer), width, height);
        ctx.putImageData(imageData, 0, 0);

        this.conbackCanvas = canvas;
        console.log(`Console: loaded conback ${width}x${height}`);
    }

    async loadCharset() {
        // Try loading from gfx.wad (like Menu does)
        const wadData = this.pak.get('gfx.wad');
        if (wadData) {
            const { WADLoader } = await import('../loaders/WADLoader.js');
            const wad = new WADLoader();
            wad.load(wadData);

            const conchars = wad.get('conchars');
            if (conchars && conchars.data) {
                const pixelData = new Uint8Array(conchars.data);
                const width = 128;
                const height = 128;

                // Convert to RGBA (index 0 = transparent)
                const rgba = new Uint8Array(width * height * 4);
                for (let i = 0; i < pixelData.length && i < width * height; i++) {
                    const palIdx = pixelData[i];
                    const dstIdx = i * 4;

                    if (palIdx === 0) {
                        rgba[dstIdx] = 0;
                        rgba[dstIdx + 1] = 0;
                        rgba[dstIdx + 2] = 0;
                        rgba[dstIdx + 3] = 0;
                    } else {
                        rgba[dstIdx] = QUAKE_PALETTE[palIdx * 3];
                        rgba[dstIdx + 1] = QUAKE_PALETTE[palIdx * 3 + 1];
                        rgba[dstIdx + 2] = QUAKE_PALETTE[palIdx * 3 + 2];
                        rgba[dstIdx + 3] = 255;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                const imageData = new ImageData(new Uint8ClampedArray(rgba.buffer), width, height);
                ctx.putImageData(imageData, 0, 0);

                this.charsetCanvas = canvas;
                return;
            }
        }

        console.warn('Console: charset not loaded');
    }

    registerBuiltinCommands() {
        // Set command checker so CVar system can detect command conflicts
        CVar_SetCommandChecker((name) => this.commands.has(name.toLowerCase()));

        // Register common Quake cvars
        this.registerCVars();

        this.registerCommand('clear', () => {
            this.clear();
        });

        this.registerCommand('echo', (args) => {
            this.print(args.join(' ') + '\n');
        });

        this.registerCommand('help', () => {
            this.print('Available commands:\n');
            for (const cmd of this.commands.keys()) {
                this.print('  ' + cmd + '\n');
            }
        });

        this.registerCommand('map', (args) => {
            if (args.length < 1) {
                this.print('usage: map <mapname>\n');
                return;
            }
            if (this.onCommand) {
                this.onCommand('map', args);
            }
        });

        this.registerCommand('god', () => {
            if (this.onCommand) {
                this.onCommand('god', []);
            }
        });

        this.registerCommand('noclip', () => {
            if (this.onCommand) {
                this.onCommand('noclip', []);
            }
        });

        this.registerCommand('give', (args) => {
            if (this.onCommand) {
                this.onCommand('give', args);
            }
        });

        this.registerCommand('quit', () => {
            this.print('Thanks for playing!\n');
        });

        // Developer mode toggle (like Quake's "developer" cvar)
        this.developerMode = false;
        this.registerCommand('developer', (args) => {
            if (args.length > 0) {
                this.developerMode = args[0] === '1' || args[0].toLowerCase() === 'true';
            } else {
                this.developerMode = !this.developerMode;
            }
            setDeveloperMode(this.developerMode);
            this.print(`Developer mode ${this.developerMode ? 'ON' : 'OFF'}\n`);
        });

        // Play sound command
        this.registerCommand('play', (args) => {
            if (args.length < 1) {
                this.print('usage: play <soundname>\n');
                return;
            }
            if (this.onCommand) {
                this.onCommand('play', args);
            }
        });

        // Play sound with volume
        this.registerCommand('playvol', (args) => {
            if (args.length < 2) {
                this.print('usage: playvol <soundname> <volume>\n');
                return;
            }
            if (this.onCommand) {
                this.onCommand('playvol', args);
            }
        });

        // Kill player command
        this.registerCommand('kill', () => {
            if (this.onCommand) {
                this.onCommand('kill', []);
            }
        });

        // Impulse command (weapon switching, etc)
        this.registerCommand('impulse', (args) => {
            if (args.length < 1) {
                this.print('usage: impulse <number>\n');
                return;
            }
            if (this.onCommand) {
                this.onCommand('impulse', args);
            }
        });

        // Sound list (debugging)
        this.registerCommand('soundlist', () => {
            if (this.onCommand) {
                this.onCommand('soundlist', []);
            }
        });

        // Sound info (debugging)
        this.registerCommand('soundinfo', () => {
            if (this.onCommand) {
                this.onCommand('soundinfo', []);
            }
        });

        // Changelevel command
        this.registerCommand('changelevel', (args) => {
            if (args.length < 1) {
                this.print('usage: changelevel <mapname>\n');
                return;
            }
            // Same as map for our purposes
            if (this.onCommand) {
                this.onCommand('map', args);
            }
        });

        // Bind command (store in local key bindings)
        this.keyBindings = new Map();
        this.registerCommand('bind', (args) => {
            if (args.length < 1) {
                this.print('usage: bind <key> [command]\n');
                return;
            }
            const key = args[0].toLowerCase();
            if (args.length === 1) {
                // Show current binding
                const binding = this.keyBindings.get(key);
                if (binding) {
                    this.print(`"${key}" = "${binding}"\n`);
                } else {
                    this.print(`"${key}" is not bound\n`);
                }
            } else {
                // Set binding
                const command = args.slice(1).join(' ');
                this.keyBindings.set(key, command);
                this.print(`bound "${key}" to "${command}"\n`);
            }
        });

        // Unbind command
        this.registerCommand('unbind', (args) => {
            if (args.length < 1) {
                this.print('usage: unbind <key>\n');
                return;
            }
            const key = args[0].toLowerCase();
            if (this.keyBindings.has(key)) {
                this.keyBindings.delete(key);
                this.print(`unbound "${key}"\n`);
            } else {
                this.print(`"${key}" is not bound\n`);
            }
        });

        // Alias command
        this.aliases = new Map();
        this.registerCommand('alias', (args) => {
            if (args.length === 0) {
                // List all aliases
                if (this.aliases.size === 0) {
                    this.print('No aliases defined.\n');
                } else {
                    this.print('Current aliases:\n');
                    for (const [name, cmd] of this.aliases) {
                        this.print(`  ${name} : ${cmd}\n`);
                    }
                }
                return;
            }
            const name = args[0];
            if (args.length === 1) {
                // Show specific alias
                const alias = this.aliases.get(name);
                if (alias) {
                    this.print(`"${name}" = "${alias}"\n`);
                } else {
                    this.print(`alias "${name}" not found\n`);
                }
            } else {
                // Set alias
                const command = args.slice(1).join(' ');
                this.aliases.set(name, command);
                this.print(`alias "${name}" = "${command}"\n`);
            }
        });

        // Status command - show game state
        this.registerCommand('status', () => {
            if (this.onCommand) {
                this.onCommand('status', []);
            }
        });

        // Version command
        this.registerCommand('version', () => {
            this.print('Quake Three.js Port\n');
            this.print('Based on id Software Quake (1996)\n');
        });

        // Wait command - delays remaining commands until next frame (cmd.c:53-56)
        // Allows: bind g "impulse 5 ; +attack ; wait ; -attack ; impulse 2"
        this.registerCommand('wait', () => {
            this.cmdWait = true;
        });

        // CVar-related commands
        this.registerCommand('cvarlist', (args) => {
            Cvar_List(args[0] || '');
        });

        this.registerCommand('set', (args) => {
            if (args.length < 2) {
                this.print('usage: set <cvar> <value>\n');
                return;
            }
            Cvar_Set(args[0], args[1]);
        });

        this.registerCommand('toggle', (args) => {
            if (args.length < 1) {
                this.print('usage: toggle <cvar>\n');
                return;
            }
            Cvar_Toggle(args[0]);
        });

        this.registerCommand('reset', (args) => {
            if (args.length < 1) {
                this.print('usage: reset <cvar>\n');
                return;
            }
            Cvar_Reset(args[0]);
        });

        this.registerCommand('resetall', () => {
            Cvar_ResetAll();
        });

        this.registerCommand('writeconfig', () => {
            Cvar_SaveConfig();
        });
    }

    /**
     * Register common Quake console variables
     */
    registerCVars() {
        // Video/rendering cvars
        Cvar_RegisterVariable('fov', '90', CVAR_ARCHIVE);
        Cvar_RegisterVariable('r_fullbright', '0', 0);
        Cvar_RegisterVariable('r_drawviewmodel', '1', CVAR_ARCHIVE);
        Cvar_RegisterVariable('r_waterwarp', '1', CVAR_ARCHIVE);
        Cvar_RegisterVariable('gl_texturemode', '0', CVAR_ARCHIVE);  // 0=nearest, 1=linear
        Cvar_RegisterVariable('gamma', '1', CVAR_ARCHIVE);

        // Audio cvars
        Cvar_RegisterVariable('volume', '0.7', CVAR_ARCHIVE);
        Cvar_RegisterVariable('bgmvolume', '0.7', CVAR_ARCHIVE);
        Cvar_RegisterVariable('ambient_level', '0.3', CVAR_ARCHIVE);
        Cvar_RegisterVariable('ambient_fade', '100', 0);

        // Gameplay cvars
        Cvar_RegisterVariable('sv_gravity', '800', CVAR_NOTIFY);
        Cvar_RegisterVariable('sv_friction', '4', CVAR_NOTIFY);
        Cvar_RegisterVariable('sv_stopspeed', '100', CVAR_NOTIFY);
        Cvar_RegisterVariable('sv_maxspeed', '320', CVAR_NOTIFY);
        Cvar_RegisterVariable('sv_accelerate', '10', CVAR_NOTIFY);

        // Player movement cvars (from cl_main.c)
        Cvar_RegisterVariable('cl_forwardspeed', '200', CVAR_ARCHIVE);
        Cvar_RegisterVariable('cl_backspeed', '200', CVAR_ARCHIVE);
        Cvar_RegisterVariable('cl_sidespeed', '350', CVAR_ARCHIVE);
        Cvar_RegisterVariable('cl_movespeedkey', '2.0', CVAR_ARCHIVE);
        Cvar_RegisterVariable('cl_upspeed', '200', CVAR_ARCHIVE);

        // View cvars (from view.c)
        Cvar_RegisterVariable('cl_bob', '0.02', CVAR_ARCHIVE);
        Cvar_RegisterVariable('cl_bobcycle', '0.6', CVAR_ARCHIVE);
        Cvar_RegisterVariable('cl_bobup', '0.5', CVAR_ARCHIVE);
        Cvar_RegisterVariable('cl_rollangle', '2.0', CVAR_ARCHIVE);
        Cvar_RegisterVariable('cl_rollspeed', '200', 0);
        Cvar_RegisterVariable('v_kicktime', '0.5', 0);
        Cvar_RegisterVariable('v_kickroll', '0.6', 0);
        Cvar_RegisterVariable('v_kickpitch', '0.6', 0);
        Cvar_RegisterVariable('v_idlescale', '0', CVAR_ARCHIVE);

        // Input cvars
        Cvar_RegisterVariable('sensitivity', '3', CVAR_ARCHIVE);
        Cvar_RegisterVariable('m_pitch', '0.022', CVAR_ARCHIVE);
        Cvar_RegisterVariable('m_yaw', '0.022', CVAR_ARCHIVE);
        Cvar_RegisterVariable('lookspring', '0', CVAR_ARCHIVE);
        Cvar_RegisterVariable('lookstrafe', '0', CVAR_ARCHIVE);
        Cvar_RegisterVariable('freelook', '1', CVAR_ARCHIVE);

        // Console/debug cvars
        Cvar_RegisterVariable('developer', '0', 0);
        Cvar_RegisterVariable('host_framerate', '0', 0);
        Cvar_RegisterVariable('showfps', '0', CVAR_ARCHIVE);

        // Load saved config
        Cvar_LoadConfig();
    }

    registerCommand(name, handler) {
        this.commands.set(name.toLowerCase(), handler);
    }

    toggle() {
        this.visible = !this.visible;
        console.log('Console.toggle() - visible:', this.visible, 'loaded:', this.loaded);
        if (this.visible) {
            this.canvas.style.display = 'block';
            // Calculate target lines for half screen coverage
            // pixelHeight = targetLines * 8 * scale
            // We want pixelHeight = containerHeight / 2
            // So targetLines = containerHeight / (2 * 8 * scale)
            const containerHeight = this.container.clientHeight;
            const scaleX = this.container.clientWidth / 320;
            const scaleY = containerHeight / 200;
            const scale = Math.min(scaleX, scaleY, 2);
            this.targetLines = Math.floor(containerHeight / (2 * 8 * scale));
            console.log('Console shown, targetLines:', this.targetLines, 'scale:', scale);
        } else {
            this.targetLines = 0;
            // Notify that console is being closed
            if (this.onClose) {
                this.onClose();
            }
        }
    }

    isVisible() {
        return this.visible || this.visibleLines > 0;
    }

    // Print text to console (like Con_Print)
    print(txt) {
        let mask = 0;

        // Check for colored text prefix
        if (txt.length > 0 && txt.charCodeAt(0) === 1) {
            mask = 128;  // Bronze color
            txt = txt.substring(1);
        } else if (txt.length > 0 && txt.charCodeAt(0) === 2) {
            mask = 128;
            txt = txt.substring(1);
        }

        for (let i = 0; i < txt.length; i++) {
            const c = txt.charCodeAt(i);

            if (this.x === 0) {
                this.linefeed();
                // Mark time for notify
                if (this.current >= 0) {
                    this.notifyTimes[this.current % NUM_CON_TIMES] = this.time;
                }
            }

            if (c === 10) {  // \n
                this.x = 0;
            } else if (c === 13) {  // \r
                this.x = 0;
            } else {
                const y = this.current % this.totalLines;
                this.text[y * this.lineWidth + this.x] = String.fromCharCode((c & 127) | mask);
                this.x++;
                if (this.x >= this.lineWidth) {
                    this.x = 0;
                }
            }
        }

        this.backscroll = 0;
    }

    linefeed() {
        this.x = 0;
        this.current++;
        // Clear the new line
        const y = this.current % this.totalLines;
        for (let i = 0; i < this.lineWidth; i++) {
            this.text[y * this.lineWidth + i] = ' ';
        }
    }

    clear() {
        this.text.fill(' ');
        this.current = this.totalLines - 1;
        this.x = 0;
        this.backscroll = 0;
    }

    /**
     * Add text to the command buffer (like Cbuf_AddText)
     */
    addText(text) {
        if (this.cmdBuffer.length + text.length >= CMD_BUFFER_SIZE) {
            this.print('Cbuf_AddText: overflow\n');
            return;
        }
        this.cmdBuffer += text;
    }

    /**
     * Execute commands from the buffer (like Cbuf_Execute from cmd.c:143-193)
     * Handles semicolon chaining and quote-aware parsing
     */
    executeBuffer() {
        while (this.cmdBuffer.length > 0) {
            // Find a \n or ; line break, respecting quotes
            let quotes = 0;
            let i = 0;

            for (i = 0; i < this.cmdBuffer.length; i++) {
                const c = this.cmdBuffer[i];
                if (c === '"') {
                    quotes++;
                }
                // Don't break on ; if inside a quoted string
                if (!(quotes & 1) && c === ';') {
                    break;
                }
                if (c === '\n') {
                    break;
                }
            }

            // Extract the command line
            const line = this.cmdBuffer.substring(0, i);

            // Remove the command from buffer (including the delimiter)
            if (i === this.cmdBuffer.length) {
                this.cmdBuffer = '';
            } else {
                this.cmdBuffer = this.cmdBuffer.substring(i + 1);
            }

            // Execute the command
            this.executeSingle(line);

            // If wait was called, stop execution until next frame
            if (this.cmdWait) {
                this.cmdWait = false;
                break;
            }
        }
    }

    /**
     * Execute a single command (no chaining)
     * This is called by executeBuffer for each individual command
     */
    executeSingle(line) {
        line = line.trim();
        if (line.length === 0) return;

        // Tokenize with quote awareness
        const { cmd, args } = this.tokenize(line);
        if (!cmd) return;

        const cmdLower = cmd.toLowerCase();

        // Check for alias first
        const alias = this.aliases.get(cmdLower);
        if (alias) {
            // Insert alias commands at beginning of buffer
            this.cmdBuffer = alias + '\n' + this.cmdBuffer;
            return;
        }

        // Try to find command
        const handler = this.commands.get(cmdLower);
        if (handler) {
            handler(args);
            return;
        }

        // Check for cvar (like Cvar_Command in original Quake)
        // If typing just the cvar name, show value; if with argument, set value
        if (Cvar_Command([cmd, ...args])) {
            return;
        }

        this.print(`Unknown command: ${cmd}\n`);
    }

    /**
     * Tokenize a command line with quote awareness (like Cmd_TokenizeString)
     * Returns { cmd, args } where args is an array
     */
    tokenize(line) {
        const args = [];
        let i = 0;

        while (i < line.length) {
            // Skip whitespace
            while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
                i++;
            }
            if (i >= line.length) break;

            let token = '';

            if (line[i] === '"') {
                // Quoted string - find closing quote
                i++; // skip opening quote
                while (i < line.length && line[i] !== '"') {
                    token += line[i];
                    i++;
                }
                i++; // skip closing quote
            } else {
                // Unquoted token - read until whitespace
                while (i < line.length && line[i] !== ' ' && line[i] !== '\t') {
                    token += line[i];
                    i++;
                }
            }

            if (token.length > 0) {
                args.push(token);
            }
        }

        return {
            cmd: args.length > 0 ? args[0] : null,
            args: args.slice(1)
        };
    }

    /**
     * Execute a command line (public API)
     * Handles the ] prompt and adds to command buffer
     */
    execute(line) {
        // Skip the ] prompt if present
        if (line.startsWith(']')) {
            line = line.substring(1);
        }

        line = line.trim();
        if (line.length === 0) return;

        // Add to buffer and execute
        this.addText(line);
        this.executeBuffer();
    }

    // Tab completion
    complete() {
        const input = this.inputLines[this.editLine].substring(1, this.linePos);
        if (input.length === 0) return;

        // Find matching commands
        const matches = [];
        for (const cmd of this.commands.keys()) {
            if (cmd.startsWith(input.toLowerCase())) {
                matches.push(cmd);
            }
        }

        // Also find matching cvars (like Cvar_CompleteVariable)
        const cvarMatches = Cvar_CompleteAll(input);
        for (const cvar of cvarMatches) {
            if (!matches.includes(cvar)) {
                matches.push(cvar);
            }
        }

        // Sort matches alphabetically
        matches.sort();

        if (matches.length === 1) {
            // Single match - complete it
            this.inputLines[this.editLine] = ']' + matches[0] + ' ';
            this.linePos = this.inputLines[this.editLine].length;
        } else if (matches.length > 1) {
            // Multiple matches - show them
            this.print('\n');
            for (const m of matches) {
                this.print('  ' + m + '\n');
            }
            // Find common prefix
            let prefix = matches[0];
            for (const m of matches) {
                while (!m.startsWith(prefix)) {
                    prefix = prefix.substring(0, prefix.length - 1);
                }
            }
            if (prefix.length > input.length) {
                this.inputLines[this.editLine] = ']' + prefix;
                this.linePos = this.inputLines[this.editLine].length;
            }
        }
    }

    handleKeyDown(e) {
        if (!this.visible) {
            // Toggle console with ` or ~
            if (e.code === 'Backquote') {
                e.preventDefault();
                this.toggle();
            }
            return;
        }

        e.preventDefault();

        const key = e.key;

        if (e.code === 'Backquote') {
            this.toggle();
            return;
        }

        if (e.code === 'Escape') {
            this.toggle();
            return;
        }

        if (e.code === 'Enter') {
            // Execute command
            const line = this.inputLines[this.editLine];
            this.print(line + '\n');
            this.execute(line);

            // Add to history
            this.editLine = (this.editLine + 1) & (HISTORY_SIZE - 1);
            this.historyLine = this.editLine;
            this.inputLines[this.editLine] = ']';
            this.linePos = 1;
            return;
        }

        if (e.code === 'Tab') {
            this.complete();
            return;
        }

        if (e.code === 'Backspace') {
            if (this.linePos > 1) {
                this.linePos--;
                this.inputLines[this.editLine] =
                    this.inputLines[this.editLine].substring(0, this.linePos);
            }
            return;
        }

        if (e.code === 'ArrowUp') {
            // History back
            let newLine = (this.historyLine - 1) & (HISTORY_SIZE - 1);
            while (newLine !== this.editLine && this.inputLines[newLine].length <= 1) {
                newLine = (newLine - 1) & (HISTORY_SIZE - 1);
            }
            if (newLine !== this.editLine && this.inputLines[newLine].length > 1) {
                this.historyLine = newLine;
                this.inputLines[this.editLine] = this.inputLines[this.historyLine];
                this.linePos = this.inputLines[this.editLine].length;
            }
            return;
        }

        if (e.code === 'ArrowDown') {
            // History forward
            if (this.historyLine === this.editLine) return;
            let newLine = (this.historyLine + 1) & (HISTORY_SIZE - 1);
            while (newLine !== this.editLine && this.inputLines[newLine].length <= 1) {
                newLine = (newLine + 1) & (HISTORY_SIZE - 1);
            }
            this.historyLine = newLine;
            if (this.historyLine === this.editLine) {
                this.inputLines[this.editLine] = ']';
                this.linePos = 1;
            } else {
                this.inputLines[this.editLine] = this.inputLines[this.historyLine];
                this.linePos = this.inputLines[this.editLine].length;
            }
            return;
        }

        if (e.code === 'PageUp') {
            this.backscroll += 2;
            if (this.backscroll > this.totalLines - 5) {
                this.backscroll = this.totalLines - 5;
            }
            return;
        }

        if (e.code === 'PageDown') {
            this.backscroll -= 2;
            if (this.backscroll < 0) {
                this.backscroll = 0;
            }
            return;
        }

        // Regular character input
        if (key.length === 1 && this.linePos < MAXCMDLINE - 1) {
            this.inputLines[this.editLine] += key;
            this.linePos++;
        }
    }

    update(deltaTime) {
        this.time += deltaTime;

        // Execute any pending commands from the buffer (for wait command support)
        if (this.cmdBuffer.length > 0) {
            this.executeBuffer();
        }

        // Animate console drop-down
        const targetPixels = this.targetLines * 8;
        const currentPixels = this.visibleLines * 8;

        if (currentPixels < targetPixels) {
            this.visibleLines += (this.dropSpeed * deltaTime) / 8;
            if (this.visibleLines > this.targetLines) {
                this.visibleLines = this.targetLines;
            }
        } else if (currentPixels > targetPixels) {
            this.visibleLines -= (this.dropSpeed * deltaTime) / 8;
            if (this.visibleLines < this.targetLines) {
                this.visibleLines = this.targetLines;
            }
        }

        // Hide canvas when fully retracted
        if (this.visibleLines <= 0 && !this.visible) {
            this.canvas.style.display = 'none';
        }
    }

    draw() {
        if (!this.loaded) {
            console.log('Console.draw() - not loaded yet');
            return;
        }
        if (this.visibleLines <= 0) {
            return;
        }

        this.resize();

        const ctx = this.ctx;
        const s = this.scale;
        const lines = Math.floor(this.visibleLines);

        if (lines <= 0) return;

        // Calculate pixel height
        const pixelHeight = lines * 8 * s;

        // Draw console background
        this.drawBackground(pixelHeight);

        // Draw text
        this.drawText(lines);

        // Draw input line
        this.drawInput(lines);
    }

    resize() {
        const containerWidth = this.container.clientWidth;
        const containerHeight = this.container.clientHeight;

        if (containerWidth === 0 || containerHeight === 0) {
            console.warn('Console resize: container has zero dimensions', containerWidth, containerHeight);
        }

        this.canvas.width = containerWidth;
        this.canvas.height = containerHeight;

        // Scale factor (320x200 base resolution)
        const scaleX = containerWidth / 320;
        const scaleY = containerHeight / 200;
        this.scale = Math.min(scaleX, scaleY, 2);

        // Recalculate line width
        this.lineWidth = Math.floor(containerWidth / (8 * this.scale)) - 2;
        if (this.lineWidth < 20) this.lineWidth = 20;
        if (this.lineWidth > 80) this.lineWidth = 80;
        this.totalLines = Math.floor(CON_TEXTSIZE / this.lineWidth);

        this.ctx.imageSmoothingEnabled = false;
    }

    drawBackground(height) {
        const ctx = this.ctx;

        if (this.conbackCanvas) {
            // Draw scaled conback
            const srcHeight = Math.min(200, Math.floor(height / this.scale));
            const srcY = 200 - srcHeight;

            ctx.drawImage(
                this.conbackCanvas,
                0, srcY, 320, srcHeight,
                0, 0, this.canvas.width, height
            );
        } else {
            // Fallback: solid dark color so console is visible even without conback
            ctx.fillStyle = '#2a1500';
            ctx.fillRect(0, 0, this.canvas.width, height);
        }
    }

    drawText(lines) {
        if (!this.charsetCanvas) return;

        const s = this.scale;
        const rows = lines - 2;  // Leave room for input line
        let y = (lines - 2) * 8 * s;

        for (let i = this.current - rows + 1; i <= this.current; i++) {
            const j = i - this.backscroll;
            if (j < 0) continue;

            const textLine = j % this.totalLines;
            const lineY = Math.round(y - (this.current - i) * 8 * s);

            for (let x = 0; x < this.lineWidth; x++) {
                const charIndex = this.text[textLine * this.lineWidth + x];
                if (charIndex && charIndex !== ' ') {
                    this.drawChar((x + 1) * 8, lineY / s, charIndex.charCodeAt(0));
                }
            }
        }
    }

    drawInput(lines) {
        if (!this.charsetCanvas) return;

        const s = this.scale;
        const y = (lines - 1) * 8;

        // Get input line with cursor
        let text = this.inputLines[this.editLine];

        // Add blinking cursor
        const cursorChar = 10 + (Math.floor(this.time * this.cursorSpeed) & 1);
        const displayText = text.substring(0, this.linePos) +
                           String.fromCharCode(cursorChar) +
                           text.substring(this.linePos + 1);

        // Handle horizontal scrolling if line is too long
        let startOffset = 0;
        if (this.linePos >= this.lineWidth) {
            startOffset = this.linePos - this.lineWidth + 1;
        }

        // Draw input line
        for (let i = 0; i < this.lineWidth && i + startOffset < displayText.length; i++) {
            const charCode = displayText.charCodeAt(i + startOffset);
            this.drawChar((i + 1) * 8, y, charCode);
        }
    }

    drawChar(x, y, charIndex) {
        if (!this.charsetCanvas) return;

        const s = this.scale;
        const charWidth = 8;
        const charHeight = 8;

        charIndex = charIndex & 255;
        const col = charIndex & 15;
        const row = charIndex >> 4;
        const srcX = col * charWidth;
        const srcY = row * charHeight;

        const dx = Math.round(x * s);
        const dy = Math.round(y * s);
        const dw = Math.round(charWidth * s);
        const dh = Math.round(charHeight * s);

        this.ctx.drawImage(
            this.charsetCanvas,
            srcX, srcY, charWidth, charHeight,
            dx, dy, dw, dh
        );
    }

    // Draw notify lines (messages during gameplay)
    drawNotify(ctx, scale, time) {
        if (!this.charsetCanvas) return 0;

        let v = 0;
        for (let i = this.current - NUM_CON_TIMES + 1; i <= this.current; i++) {
            if (i < 0) continue;

            const notifyTime = this.notifyTimes[i % NUM_CON_TIMES];
            if (notifyTime === 0) continue;

            const age = time - notifyTime;
            if (age > this.notifyTimeout) continue;

            const textLine = i % this.totalLines;

            for (let x = 0; x < this.lineWidth; x++) {
                const charIndex = this.text[textLine * this.lineWidth + x];
                if (charIndex && charIndex !== ' ') {
                    const charCode = charIndex.charCodeAt(0);
                    // Draw with some transparency based on age
                    const alpha = 1 - (age / this.notifyTimeout) * 0.5;
                    ctx.globalAlpha = alpha;
                    this.drawCharTo(ctx, (x + 1) * 8, v, charCode, scale);
                    ctx.globalAlpha = 1;
                }
            }
            v += 8;
        }

        return v;
    }

    drawCharTo(ctx, x, y, charIndex, scale) {
        if (!this.charsetCanvas) return;

        const charWidth = 8;
        const charHeight = 8;

        charIndex = charIndex & 255;
        const col = charIndex & 15;
        const row = charIndex >> 4;
        const srcX = col * charWidth;
        const srcY = row * charHeight;

        const dx = Math.round(x * scale);
        const dy = Math.round(y * scale);
        const dw = Math.round(charWidth * scale);
        const dh = Math.round(charHeight * scale);

        ctx.drawImage(
            this.charsetCanvas,
            srcX, srcY, charWidth, charHeight,
            dx, dy, dw, dh
        );
    }

    destroy() {
        document.removeEventListener('keydown', this.boundKeyDown);
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
    }
}

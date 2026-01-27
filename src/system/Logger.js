/**
 * Logger - Quake-style console logging
 *
 * Original Quake used Con_Printf and Con_DPrintf to print to the
 * in-game console. This module replicates that behavior, printing
 * to both the browser console and the in-game console.
 */

// Reference to the game console (set by Game.js)
let gameConsole = null;

// Developer mode flag (like Quake's "developer" cvar)
let developerMode = false;

/**
 * Set the game console reference
 */
export function setConsole(console) {
    gameConsole = console;
}

/**
 * Set developer mode (enables Con_DPrintf output)
 */
export function setDeveloperMode(enabled) {
    developerMode = enabled;
}

/**
 * Con_Printf - Print to console (always visible)
 * Like original Quake's Con_Printf
 */
export function Con_Printf(fmt, ...args) {
    let msg = fmt;

    // Simple string formatting (replace %s, %d, %f, %i)
    if (args.length > 0) {
        let argIndex = 0;
        msg = fmt.replace(/%[sdfi]/g, (match) => {
            if (argIndex >= args.length) return match;
            const arg = args[argIndex++];
            switch (match) {
                case '%s': return String(arg);
                case '%d':
                case '%i': return Math.floor(arg);
                case '%f': return Number(arg).toFixed(2);
                default: return arg;
            }
        });
    }

    // Print to browser console
    console.log(msg.replace(/\n$/, ''));

    // Print to in-game console
    if (gameConsole) {
        gameConsole.print(msg);
    }
}

/**
 * Con_DPrintf - Developer-only print (only when developer mode is on)
 * Like original Quake's Con_DPrintf
 */
export function Con_DPrintf(fmt, ...args) {
    if (!developerMode) return;
    Con_Printf(fmt, ...args);
}

/**
 * Con_SafePrintf - Safe print (won't cause screen updates)
 * For our purposes, same as Con_Printf
 */
export function Con_SafePrintf(fmt, ...args) {
    Con_Printf(fmt, ...args);
}

// Shorthand aliases
export const printf = Con_Printf;
export const dprintf = Con_DPrintf;

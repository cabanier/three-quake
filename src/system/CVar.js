/**
 * CVar - Console Variable System
 *
 * Direct port of Quake's cvar.c for dynamic variable tracking.
 * CVars can be registered, queried, and modified at runtime.
 *
 * Flags:
 * - CVAR_ARCHIVE: Save to config file
 * - CVAR_NOTIFY: Notify players when changed
 * - CVAR_READONLY: Cannot be changed from console
 */

import { Con_Printf, Con_DPrintf } from './Logger.js';

// CVar flags (matching original Quake)
export const CVAR_ARCHIVE = 1;   // Save to config
export const CVAR_NOTIFY = 2;    // Notify on change (for server cvars)
export const CVAR_READONLY = 4;  // Cannot be changed by user

// CVar storage - linked list in original, Map for JS
const cvars = new Map();

// Commands storage (for checking conflicts)
let commandExists = () => false;

/**
 * Set command existence checker
 * @param {Function} checker - Function that takes name and returns true if command exists
 */
export function CVar_SetCommandChecker(checker) {
    commandExists = checker;
}

/**
 * Register a new console variable
 * @param {string} name - Variable name
 * @param {string} defaultValue - Default string value
 * @param {number} flags - CVAR_* flags
 * @returns {Object} The registered cvar object
 */
export function Cvar_RegisterVariable(name, defaultValue, flags = 0) {
    // Check if already defined
    if (cvars.has(name)) {
        Con_Printf(`Can't register variable ${name}, already defined\n`);
        return cvars.get(name);
    }

    // Check for conflict with commands
    if (commandExists(name)) {
        Con_Printf(`Cvar_RegisterVariable: ${name} is a command\n`);
        return null;
    }

    // Create cvar object
    const cvar = {
        name: name,
        string: String(defaultValue),
        value: parseFloat(defaultValue) || 0,
        defaultValue: String(defaultValue),
        flags: flags,
        archive: (flags & CVAR_ARCHIVE) !== 0,
        notify: (flags & CVAR_NOTIFY) !== 0,
        readonly: (flags & CVAR_READONLY) !== 0
    };

    cvars.set(name, cvar);
    Con_DPrintf(`Registered cvar: ${name} = "${defaultValue}"\n`);

    return cvar;
}

/**
 * Find a cvar by name
 * @param {string} name - Variable name
 * @returns {Object|null} The cvar object or null
 */
export function Cvar_FindVar(name) {
    return cvars.get(name) || null;
}

/**
 * Get the numeric value of a cvar
 * @param {string} name - Variable name
 * @returns {number} The value, or 0 if not found
 */
export function Cvar_VariableValue(name) {
    const cvar = cvars.get(name);
    if (!cvar) return 0;
    return cvar.value;
}

/**
 * Get the string value of a cvar
 * @param {string} name - Variable name
 * @returns {string} The value, or empty string if not found
 */
export function Cvar_VariableString(name) {
    const cvar = cvars.get(name);
    if (!cvar) return '';
    return cvar.string;
}

/**
 * Set a cvar's value by string
 * @param {string} name - Variable name
 * @param {string} value - New string value
 * @returns {boolean} True if set successfully
 */
export function Cvar_Set(name, value) {
    const cvar = cvars.get(name);
    if (!cvar) {
        Con_Printf(`Cvar_Set: variable ${name} not found\n`);
        return false;
    }

    if (cvar.readonly) {
        Con_Printf(`${name} is read-only\n`);
        return false;
    }

    const changed = cvar.string !== value;

    cvar.string = String(value);
    cvar.value = parseFloat(value) || 0;

    if (cvar.notify && changed) {
        Con_Printf(`"${name}" changed to "${value}"\n`);
    }

    return true;
}

/**
 * Set a cvar's value by number
 * @param {string} name - Variable name
 * @param {number} value - New numeric value
 * @returns {boolean} True if set successfully
 */
export function Cvar_SetValue(name, value) {
    return Cvar_Set(name, String(value));
}

/**
 * Toggle a cvar between 0 and 1
 * @param {string} name - Variable name
 * @returns {boolean} True if toggled successfully
 */
export function Cvar_Toggle(name) {
    const cvar = cvars.get(name);
    if (!cvar) {
        Con_Printf(`Cvar_Toggle: variable ${name} not found\n`);
        return false;
    }

    return Cvar_Set(name, cvar.value ? '0' : '1');
}

/**
 * Complete a partial cvar name (for tab completion)
 * @param {string} partial - Partial name to match
 * @returns {string|null} First matching cvar name, or null
 */
export function Cvar_CompleteVariable(partial) {
    if (!partial || partial.length === 0) return null;

    const partialLower = partial.toLowerCase();
    for (const [name] of cvars) {
        if (name.toLowerCase().startsWith(partialLower)) {
            return name;
        }
    }

    return null;
}

/**
 * Get all cvars matching a partial name (for tab completion)
 * @param {string} partial - Partial name to match
 * @returns {string[]} Array of matching cvar names
 */
export function Cvar_CompleteAll(partial) {
    const matches = [];
    const partialLower = partial.toLowerCase();

    for (const [name] of cvars) {
        if (name.toLowerCase().startsWith(partialLower)) {
            matches.push(name);
        }
    }

    return matches;
}

/**
 * Handle a cvar command from console
 * @param {string[]} args - Command arguments (cvar name, optional value)
 * @returns {boolean} True if handled as a cvar command
 */
export function Cvar_Command(args) {
    if (args.length === 0) return false;

    const cvar = cvars.get(args[0]);
    if (!cvar) return false;

    // Print current value if no argument given
    if (args.length === 1) {
        Con_Printf(`"${cvar.name}" is "${cvar.string}"\n`);
        return true;
    }

    // Set new value
    Cvar_Set(cvar.name, args[1]);
    return true;
}

/**
 * Get all archive cvars as config lines
 * @returns {string[]} Array of "cvarname value" strings
 */
export function Cvar_WriteVariables() {
    const lines = [];

    for (const [name, cvar] of cvars) {
        if (cvar.archive) {
            lines.push(`${name} "${cvar.string}"`);
        }
    }

    return lines;
}

/**
 * List all registered cvars
 * @param {string} filter - Optional filter string
 */
export function Cvar_List(filter = '') {
    const filterLower = filter.toLowerCase();
    let count = 0;

    Con_Printf('CVars:\n');
    for (const [name, cvar] of cvars) {
        if (filter && !name.toLowerCase().includes(filterLower)) {
            continue;
        }

        let flags = '';
        if (cvar.archive) flags += 'A';
        if (cvar.notify) flags += 'N';
        if (cvar.readonly) flags += 'R';
        if (flags) flags = ` [${flags}]`;

        Con_Printf(`  ${name} = "${cvar.string}"${flags}\n`);
        count++;
    }
    Con_Printf(`${count} cvars\n`);
}

/**
 * Reset a cvar to its default value
 * @param {string} name - Variable name
 */
export function Cvar_Reset(name) {
    const cvar = cvars.get(name);
    if (!cvar) {
        Con_Printf(`Cvar_Reset: variable ${name} not found\n`);
        return;
    }

    Cvar_Set(name, cvar.defaultValue);
}

/**
 * Reset all cvars to their default values
 */
export function Cvar_ResetAll() {
    for (const [name, cvar] of cvars) {
        if (!cvar.readonly) {
            Cvar_Set(name, cvar.defaultValue);
        }
    }
    Con_Printf('All cvars reset to defaults\n');
}

/**
 * Save archive cvars to localStorage
 */
export function Cvar_SaveConfig() {
    const config = {};
    for (const [name, cvar] of cvars) {
        if (cvar.archive) {
            config[name] = cvar.string;
        }
    }

    try {
        localStorage.setItem('quake_cvars', JSON.stringify(config));
        Con_Printf('Config saved\n');
    } catch (e) {
        Con_Printf(`Failed to save config: ${e.message}\n`);
    }
}

/**
 * Load archive cvars from localStorage
 */
export function Cvar_LoadConfig() {
    try {
        const stored = localStorage.getItem('quake_cvars');
        if (!stored) return;

        const config = JSON.parse(stored);
        for (const [name, value] of Object.entries(config)) {
            const cvar = cvars.get(name);
            if (cvar && cvar.archive) {
                Cvar_Set(name, value);
            }
        }
        Con_DPrintf('Config loaded from localStorage\n');
    } catch (e) {
        Con_Printf(`Failed to load config: ${e.message}\n`);
    }
}

/**
 * Get all cvars as an object (for debugging)
 * @returns {Object} Object with cvar names as keys
 */
export function Cvar_GetAll() {
    const result = {};
    for (const [name, cvar] of cvars) {
        result[name] = {
            value: cvar.value,
            string: cvar.string,
            flags: cvar.flags
        };
    }
    return result;
}

import { BinaryReader } from '../utils/BinaryReader.js';

/**
 * PAKLoader - Loads Quake PAK archive files
 *
 * PAK Format:
 * - Header: "PACK" (4 bytes) + directory offset (int32) + directory length (int32)
 * - Directory Entry: filename (56 bytes, null-terminated) + offset (int32) + length (int32)
 */
export class PAKLoader {
    constructor() {
        this.files = new Map();
        this.reader = null;
    }

    async load(arrayBuffer) {
        this.reader = new BinaryReader(arrayBuffer);

        // Read header
        const magic = this.reader.readString(4);
        if (magic !== 'PACK') {
            throw new Error('Invalid PAK file: bad magic number');
        }

        const dirOffset = this.reader.readInt32();
        const dirLength = this.reader.readInt32();
        const numFiles = dirLength / 64; // Each entry is 64 bytes

        console.log(`PAK: Loading ${numFiles} files`);

        // Read directory
        this.reader.seek(dirOffset);

        for (let i = 0; i < numFiles; i++) {
            const name = this.reader.readString(56).toLowerCase();
            const offset = this.reader.readInt32();
            const length = this.reader.readInt32();

            this.files.set(name, { offset, length });
        }

        return this;
    }

    has(filename) {
        return this.files.has(filename.toLowerCase());
    }

    get(filename) {
        const entry = this.files.get(filename.toLowerCase());
        if (!entry) {
            return null;
        }

        return this.reader.getBuffer(entry.offset, entry.length);
    }

    getAsString(filename) {
        const buffer = this.get(filename);
        if (!buffer) return null;

        const decoder = new TextDecoder('utf-8');
        return decoder.decode(buffer);
    }

    list(prefix = '') {
        const result = [];
        const lowerPrefix = prefix.toLowerCase();

        for (const [name] of this.files) {
            if (name.startsWith(lowerPrefix)) {
                result.push(name);
            }
        }

        return result;
    }

    listByExtension(ext) {
        const lowerExt = ext.toLowerCase();
        return this.list().filter(name => name.endsWith(lowerExt));
    }
}

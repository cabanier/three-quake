import { BinaryReader } from '../utils/BinaryReader.js';
import { indexedToRGBA, QUAKE_PALETTE } from './Palette.js';

/**
 * WADLoader - Loads Quake WAD texture files
 *
 * WAD Format:
 * - Header: "WAD2" (4 bytes) + numEntries (int32) + dirOffset (int32)
 * - Directory Entry: offset (int32) + diskSize (int32) + size (int32) + type (byte) + compression (byte) + padding (2 bytes) + name (16 bytes)
 * - Texture: name (16 bytes) + width (uint32) + height (uint32) + mipOffsets[4] + data
 */

const WAD_MAGIC = 'WAD2';

export class WADLoader {
    constructor() {
        this.textures = new Map();
        this.reader = null;
    }

    load(arrayBuffer) {
        this.reader = new BinaryReader(arrayBuffer);

        // Read header
        const magic = this.reader.readString(4);
        if (magic !== WAD_MAGIC) {
            throw new Error('Invalid WAD file: bad magic number');
        }

        const numEntries = this.reader.readInt32();
        const dirOffset = this.reader.readInt32();

        console.log(`WAD: Loading ${numEntries} entries`);

        // Read directory
        this.reader.seek(dirOffset);

        const entries = [];
        for (let i = 0; i < numEntries; i++) {
            entries.push({
                offset: this.reader.readInt32(),
                diskSize: this.reader.readInt32(),
                size: this.reader.readInt32(),
                type: this.reader.readUint8(),
                compression: this.reader.readUint8(),
                padding: this.reader.readUint16(),
                name: this.reader.readString(16).toLowerCase()
            });
        }

        // Parse entries by type
        // WAD2 types: 0x40/@=palette, 0x42/B=QPIC, 0x43/C=MIPTEX, 0x44/D=RAW, 0x45/E=COLORMAP
        for (const entry of entries) {
            // Debug: log conchars entry info
            if (entry.name === 'conchars') {
                console.log(`conchars entry: type=0x${entry.type.toString(16)}, size=${entry.size}, offset=${entry.offset}`);
            }

            if (entry.type === 0x43) {
                // Miptex (textures)
                this.parseTexture(entry);
            } else if (entry.type === 0x42 || entry.type === 0x40) {
                // QPic (flat images like HUD elements)
                this.parsePic(entry);
            } else if (entry.type === 0x44 || entry.type === 0x45) {
                // Raw data (like conchars, colormap)
                this.parseRaw(entry);
            } else {
                // Handle unknown types as raw data (for conchars which might have different type)
                this.parseRaw(entry);
            }
        }

        return this;
    }

    parseTexture(entry) {
        this.reader.seek(entry.offset);

        const name = this.reader.readString(16).toLowerCase();
        const width = this.reader.readUint32();
        const height = this.reader.readUint32();

        const mipOffsets = [
            this.reader.readUint32(),
            this.reader.readUint32(),
            this.reader.readUint32(),
            this.reader.readUint32()
        ];

        // Read mip level 0 (full resolution)
        let data = null;
        if (mipOffsets[0] > 0) {
            this.reader.seek(entry.offset + mipOffsets[0]);
            data = this.reader.readBytes(width * height);
        }

        this.textures.set(name, {
            name,
            width,
            height,
            mipOffsets,
            data,
            type: 'texture'
        });
    }

    parsePic(entry) {
        this.reader.seek(entry.offset);

        // QPic format: width (int32) + height (int32) + data
        const width = this.reader.readUint32();
        const height = this.reader.readUint32();
        const data = this.reader.readBytes(width * height);

        this.textures.set(entry.name, {
            name: entry.name,
            width,
            height,
            data,
            type: 'pic'
        });
    }

    parseRaw(entry) {
        this.reader.seek(entry.offset);

        // Raw format: just pixel data, no header
        // For conchars, it's 128x128 (16384 bytes)
        const data = this.reader.readBytes(entry.size);

        // Determine dimensions based on size (conchars is 128x128)
        let width = 128;
        let height = 128;
        if (entry.size === 16384) {
            width = 128;
            height = 128;
        } else if (entry.size === 256) {
            // Colormap is 256x1
            width = 256;
            height = 1;
        }

        this.textures.set(entry.name, {
            name: entry.name,
            width,
            height,
            data,
            type: 'raw'
        });
    }

    has(name) {
        return this.textures.has(name.toLowerCase());
    }

    get(name) {
        return this.textures.get(name.toLowerCase());
    }

    getRGBA(name) {
        const texture = this.get(name);
        if (!texture || !texture.data) {
            return null;
        }

        return {
            width: texture.width,
            height: texture.height,
            data: indexedToRGBA(texture.data, texture.width, texture.height)
        };
    }

    list() {
        return Array.from(this.textures.keys());
    }
}

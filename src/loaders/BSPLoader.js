import { BinaryReader } from '../utils/BinaryReader.js';
import { indexedToRGBA, QUAKE_PALETTE } from './Palette.js';

/**
 * BSPLoader - Loads Quake BSP level files (version 29)
 *
 * Lump indices:
 * 0: Entities, 1: Planes, 2: Textures, 3: Vertices, 4: Visibility,
 * 5: Nodes, 6: Texinfo, 7: Faces, 8: Lighting, 9: Clipnodes,
 * 10: Leafs, 11: Marksurfaces, 12: Edges, 13: Surfedges, 14: Models
 */

const LUMP_ENTITIES = 0;
const LUMP_PLANES = 1;
const LUMP_TEXTURES = 2;
const LUMP_VERTICES = 3;
const LUMP_VISIBILITY = 4;
const LUMP_NODES = 5;
const LUMP_TEXINFO = 6;
const LUMP_FACES = 7;
const LUMP_LIGHTING = 8;
const LUMP_CLIPNODES = 9;
const LUMP_LEAFS = 10;
const LUMP_MARKSURFACES = 11;
const LUMP_EDGES = 12;
const LUMP_SURFEDGES = 13;
const LUMP_MODELS = 14;

const BSP_VERSION = 29;

export class BSPLoader {
    constructor() {
        this.entities = [];
        this.planes = [];
        this.textures = [];
        this.vertices = [];
        this.visibility = null;
        this.nodes = [];
        this.texinfo = [];
        this.faces = [];
        this.lighting = null;
        this.clipnodes = [];
        this.leafs = [];
        this.marksurfaces = [];
        this.edges = [];
        this.surfedges = [];
        this.models = [];
    }

    load(arrayBuffer) {
        const reader = new BinaryReader(arrayBuffer);

        // Read header
        const version = reader.readInt32();
        if (version !== BSP_VERSION) {
            throw new Error(`Invalid BSP version: ${version}, expected ${BSP_VERSION}`);
        }

        // Read lump directory (15 lumps × 8 bytes each)
        const lumps = [];
        for (let i = 0; i < 15; i++) {
            lumps.push({
                offset: reader.readInt32(),
                length: reader.readInt32()
            });
        }

        // Parse each lump
        this.parseEntities(reader, lumps[LUMP_ENTITIES]);
        this.parsePlanes(reader, lumps[LUMP_PLANES]);
        this.parseTextures(reader, lumps[LUMP_TEXTURES]);
        this.parseVertices(reader, lumps[LUMP_VERTICES]);
        this.parseVisibility(reader, lumps[LUMP_VISIBILITY]);
        this.parseNodes(reader, lumps[LUMP_NODES]);
        this.parseTexinfo(reader, lumps[LUMP_TEXINFO]);
        this.parseFaces(reader, lumps[LUMP_FACES]);
        this.parseLighting(reader, lumps[LUMP_LIGHTING]);
        this.parseClipnodes(reader, lumps[LUMP_CLIPNODES]);
        this.parseLeafs(reader, lumps[LUMP_LEAFS]);
        this.parseMarksurfaces(reader, lumps[LUMP_MARKSURFACES]);
        this.parseEdges(reader, lumps[LUMP_EDGES]);
        this.parseSurfedges(reader, lumps[LUMP_SURFEDGES]);
        this.parseModels(reader, lumps[LUMP_MODELS]);

        console.log(`BSP loaded: ${this.faces.length} faces, ${this.textures.length} textures, ${this.entities.length} entities`);

        return this;
    }

    parseEntities(reader, lump) {
        reader.seek(lump.offset);
        const text = reader.readString(lump.length);

        // Parse entity string format:
        // { "key" "value" "key2" "value2" }
        const regex = /\{([^}]+)\}/g;
        let match;

        while ((match = regex.exec(text)) !== null) {
            const entity = {};
            const content = match[1];
            const keyValueRegex = /"([^"]+)"\s+"([^"]*)"/g;
            let kvMatch;

            while ((kvMatch = keyValueRegex.exec(content)) !== null) {
                entity[kvMatch[1]] = kvMatch[2];
            }

            // Parse origin if present
            if (entity.origin) {
                const parts = entity.origin.split(' ').map(Number);
                entity._origin = { x: parts[0], y: parts[1], z: parts[2] };
            }

            // Parse angle if present
            if (entity.angle) {
                entity._angle = Number(entity.angle);
            }

            this.entities.push(entity);
        }
    }

    parsePlanes(reader, lump) {
        reader.seek(lump.offset);
        const count = lump.length / 20; // 20 bytes per plane

        for (let i = 0; i < count; i++) {
            this.planes.push({
                normal: {
                    x: reader.readFloat32(),
                    y: reader.readFloat32(),
                    z: reader.readFloat32()
                },
                dist: reader.readFloat32(),
                type: reader.readInt32()
            });
        }
    }

    parseTextures(reader, lump) {
        if (lump.length === 0) return;

        reader.seek(lump.offset);
        const numTextures = reader.readInt32();
        const offsets = [];

        for (let i = 0; i < numTextures; i++) {
            offsets.push(reader.readInt32());
        }

        for (let i = 0; i < numTextures; i++) {
            if (offsets[i] === -1) {
                this.textures.push(null);
                continue;
            }

            reader.seek(lump.offset + offsets[i]);

            const texture = {
                name: reader.readString(16),
                width: reader.readUint32(),
                height: reader.readUint32(),
                mipOffsets: [
                    reader.readUint32(),
                    reader.readUint32(),
                    reader.readUint32(),
                    reader.readUint32()
                ],
                data: null
            };

            // Read mip level 0 (full resolution)
            if (texture.mipOffsets[0] > 0) {
                const pixelCount = texture.width * texture.height;
                reader.seek(lump.offset + offsets[i] + texture.mipOffsets[0]);
                texture.data = reader.readBytes(pixelCount);
            }

            this.textures.push(texture);
        }
    }

    parseVertices(reader, lump) {
        reader.seek(lump.offset);
        const count = lump.length / 12; // 12 bytes per vertex (3 floats)

        for (let i = 0; i < count; i++) {
            this.vertices.push({
                x: reader.readFloat32(),
                y: reader.readFloat32(),
                z: reader.readFloat32()
            });
        }
    }

    parseVisibility(reader, lump) {
        if (lump.length === 0) return;
        reader.seek(lump.offset);
        this.visibility = reader.readBytes(lump.length);
    }

    parseNodes(reader, lump) {
        reader.seek(lump.offset);
        const count = lump.length / 24; // 24 bytes per node

        for (let i = 0; i < count; i++) {
            this.nodes.push({
                planeNum: reader.readInt32(),
                children: [reader.readInt16(), reader.readInt16()],
                mins: [reader.readInt16(), reader.readInt16(), reader.readInt16()],
                maxs: [reader.readInt16(), reader.readInt16(), reader.readInt16()],
                firstFace: reader.readUint16(),
                numFaces: reader.readUint16()
            });
        }
    }

    parseTexinfo(reader, lump) {
        reader.seek(lump.offset);
        const count = lump.length / 40; // 40 bytes per texinfo

        for (let i = 0; i < count; i++) {
            this.texinfo.push({
                s: {
                    x: reader.readFloat32(),
                    y: reader.readFloat32(),
                    z: reader.readFloat32(),
                    offset: reader.readFloat32()
                },
                t: {
                    x: reader.readFloat32(),
                    y: reader.readFloat32(),
                    z: reader.readFloat32(),
                    offset: reader.readFloat32()
                },
                textureIndex: reader.readInt32(),
                flags: reader.readInt32()
            });
        }
    }

    parseFaces(reader, lump) {
        reader.seek(lump.offset);
        const count = lump.length / 20; // 20 bytes per face

        for (let i = 0; i < count; i++) {
            this.faces.push({
                planeNum: reader.readInt16(),
                side: reader.readInt16(),
                firstEdge: reader.readInt32(),
                numEdges: reader.readInt16(),
                texinfoNum: reader.readInt16(),
                styles: [
                    reader.readUint8(),
                    reader.readUint8(),
                    reader.readUint8(),
                    reader.readUint8()
                ],
                lightmapOffset: reader.readInt32()
            });
        }
    }

    parseLighting(reader, lump) {
        if (lump.length === 0) return;
        reader.seek(lump.offset);
        this.lighting = reader.readBytes(lump.length);
    }

    parseClipnodes(reader, lump) {
        reader.seek(lump.offset);
        const count = lump.length / 8; // 8 bytes per clipnode

        for (let i = 0; i < count; i++) {
            this.clipnodes.push({
                planeNum: reader.readInt32(),
                children: [reader.readInt16(), reader.readInt16()]
            });
        }
    }

    parseLeafs(reader, lump) {
        reader.seek(lump.offset);
        const count = lump.length / 28; // 28 bytes per leaf

        for (let i = 0; i < count; i++) {
            this.leafs.push({
                contents: reader.readInt32(),
                visOffset: reader.readInt32(),
                mins: [reader.readInt16(), reader.readInt16(), reader.readInt16()],
                maxs: [reader.readInt16(), reader.readInt16(), reader.readInt16()],
                firstMarksurface: reader.readUint16(),
                numMarksurfaces: reader.readUint16(),
                ambientLevel: [
                    reader.readUint8(),
                    reader.readUint8(),
                    reader.readUint8(),
                    reader.readUint8()
                ]
            });
        }
    }

    parseMarksurfaces(reader, lump) {
        reader.seek(lump.offset);
        const count = lump.length / 2; // 2 bytes per marksurface

        for (let i = 0; i < count; i++) {
            this.marksurfaces.push(reader.readUint16());
        }
    }

    parseEdges(reader, lump) {
        reader.seek(lump.offset);
        const count = lump.length / 4; // 4 bytes per edge

        for (let i = 0; i < count; i++) {
            this.edges.push({
                v: [reader.readUint16(), reader.readUint16()]
            });
        }
    }

    parseSurfedges(reader, lump) {
        reader.seek(lump.offset);
        const count = lump.length / 4; // 4 bytes per surfedge

        for (let i = 0; i < count; i++) {
            this.surfedges.push(reader.readInt32());
        }
    }

    parseModels(reader, lump) {
        reader.seek(lump.offset);
        const count = lump.length / 64; // 64 bytes per model

        for (let i = 0; i < count; i++) {
            this.models.push({
                mins: {
                    x: reader.readFloat32(),
                    y: reader.readFloat32(),
                    z: reader.readFloat32()
                },
                maxs: {
                    x: reader.readFloat32(),
                    y: reader.readFloat32(),
                    z: reader.readFloat32()
                },
                origin: {
                    x: reader.readFloat32(),
                    y: reader.readFloat32(),
                    z: reader.readFloat32()
                },
                headnode: [
                    reader.readInt32(),
                    reader.readInt32(),
                    reader.readInt32(),
                    reader.readInt32()
                ],
                visLeafs: reader.readInt32(),
                firstFace: reader.readInt32(),
                numFaces: reader.readInt32()
            });
        }
    }

    // Get vertices for a face
    getFaceVertices(faceIndex) {
        const face = this.faces[faceIndex];
        const vertices = [];

        for (let i = 0; i < face.numEdges; i++) {
            const surfedge = this.surfedges[face.firstEdge + i];
            const edge = this.edges[Math.abs(surfedge)];
            const vertexIndex = surfedge >= 0 ? edge.v[0] : edge.v[1];
            vertices.push(this.vertices[vertexIndex]);
        }

        return vertices;
    }

    // Get UV coordinates for a vertex on a face
    getVertexUV(vertex, texinfo, texture) {
        if (!texture) return { u: 0, v: 0 };

        const s = texinfo.s;
        const t = texinfo.t;

        const u = (vertex.x * s.x + vertex.y * s.y + vertex.z * s.z + s.offset) / texture.width;
        const v = (vertex.x * t.x + vertex.y * t.y + vertex.z * t.z + t.offset) / texture.height;

        return { u, v };
    }

    // Calculate lightmap size for a face
    getFaceLightmapSize(faceIndex) {
        const face = this.faces[faceIndex];
        const texinfo = this.texinfo[face.texinfoNum];
        const vertices = this.getFaceVertices(faceIndex);

        let minS = Infinity, maxS = -Infinity;
        let minT = Infinity, maxT = -Infinity;

        for (const v of vertices) {
            const s = v.x * texinfo.s.x + v.y * texinfo.s.y + v.z * texinfo.s.z + texinfo.s.offset;
            const t = v.x * texinfo.t.x + v.y * texinfo.t.y + v.z * texinfo.t.z + texinfo.t.offset;

            minS = Math.min(minS, s);
            maxS = Math.max(maxS, s);
            minT = Math.min(minT, t);
            maxT = Math.max(maxT, t);
        }

        const width = Math.ceil(maxS / 16) - Math.floor(minS / 16) + 1;
        const height = Math.ceil(maxT / 16) - Math.floor(minT / 16) + 1;

        return {
            width,
            height,
            minS: Math.floor(minS / 16) * 16,
            minT: Math.floor(minT / 16) * 16
        };
    }

    // Get entities by classname
    getEntitiesByClass(classname) {
        return this.entities.filter(e => e.classname === classname);
    }

    // Find player start position and angle
    getPlayerStart() {
        const starts = this.getEntitiesByClass('info_player_start');
        if (starts.length > 0 && starts[0]._origin) {
            return {
                position: starts[0]._origin,
                angle: starts[0]._angle || 0
            };
        }

        // Fallback to deathmatch spawn
        const dmStarts = this.getEntitiesByClass('info_player_deathmatch');
        if (dmStarts.length > 0 && dmStarts[0]._origin) {
            return {
                position: dmStarts[0]._origin,
                angle: dmStarts[0]._angle || 0
            };
        }

        return { position: { x: 0, y: 0, z: 0 }, angle: 0 };
    }

    // Get level name from worldspawn message field
    getLevelName() {
        const worldspawn = this.getEntitiesByClass('worldspawn');
        if (worldspawn.length > 0 && worldspawn[0].message) {
            return worldspawn[0].message;
        }
        return null;
    }

    // Get music track from worldspawn sounds field
    // Original Quake: worldspawn.sounds = CD track number
    getMusicTrack() {
        const worldspawn = this.getEntitiesByClass('worldspawn');
        if (worldspawn.length > 0 && worldspawn[0].sounds) {
            return parseInt(worldspawn[0].sounds);
        }
        return null;
    }
}

import { BinaryReader } from '../utils/BinaryReader.js';
import { indexedToRGBA, QUAKE_PALETTE } from './Palette.js';

/**
 * MDLLoader - Loads Quake MDL (Alias) model files
 *
 * MDL Format:
 * - Header: "IDPO" + version (6) + scale + origin + bounds + flags + sizes
 * - Skins: indexed color texture data
 * - ST Vertices: texture coordinates
 * - Triangles: face indices + front/back flags
 * - Frames: compressed vertex data for animation
 */

const MDL_MAGIC = 0x4F504449; // "IDPO"
const MDL_VERSION = 6;

export class MDLLoader {
    constructor() {
        this.header = null;
        this.skins = [];
        this.texcoords = [];
        this.triangles = [];
        this.frames = [];
    }

    load(arrayBuffer) {
        const reader = new BinaryReader(arrayBuffer);

        // Read header
        const magic = reader.readInt32();
        if (magic !== MDL_MAGIC) {
            throw new Error('Invalid MDL file: bad magic number');
        }

        const version = reader.readInt32();
        if (version !== MDL_VERSION) {
            throw new Error(`Invalid MDL version: ${version}, expected ${MDL_VERSION}`);
        }

        this.header = {
            scale: {
                x: reader.readFloat32(),
                y: reader.readFloat32(),
                z: reader.readFloat32()
            },
            origin: {
                x: reader.readFloat32(),
                y: reader.readFloat32(),
                z: reader.readFloat32()
            },
            radius: reader.readFloat32(),
            eyePosition: {
                x: reader.readFloat32(),
                y: reader.readFloat32(),
                z: reader.readFloat32()
            },
            numSkins: reader.readInt32(),
            skinWidth: reader.readInt32(),
            skinHeight: reader.readInt32(),
            numVerts: reader.readInt32(),
            numTris: reader.readInt32(),
            numFrames: reader.readInt32(),
            syncType: reader.readInt32(),
            flags: reader.readInt32(),
            size: reader.readFloat32()
        };

        // Read skins
        this.readSkins(reader);

        // Read texture coordinates
        this.readTexcoords(reader);

        // Read triangles
        this.readTriangles(reader);

        // Read frames
        this.readFrames(reader);

        console.log(`MDL loaded: ${this.header.numVerts} verts, ${this.header.numTris} tris, ${this.header.numFrames} frames`);

        return this;
    }

    readSkins(reader) {
        const { numSkins, skinWidth, skinHeight } = this.header;
        const skinSize = skinWidth * skinHeight;

        for (let i = 0; i < numSkins; i++) {
            const type = reader.readInt32();

            if (type === 0) {
                // Single skin
                const data = reader.readBytes(skinSize);
                this.skins.push({
                    type: 'single',
                    width: skinWidth,
                    height: skinHeight,
                    data: data
                });
            } else {
                // Skin group (animated skin)
                const numSkins = reader.readInt32();
                const times = [];
                for (let j = 0; j < numSkins; j++) {
                    times.push(reader.readFloat32());
                }

                const groupSkins = [];
                for (let j = 0; j < numSkins; j++) {
                    groupSkins.push(reader.readBytes(skinSize));
                }

                this.skins.push({
                    type: 'group',
                    width: skinWidth,
                    height: skinHeight,
                    times: times,
                    data: groupSkins
                });
            }
        }
    }

    readTexcoords(reader) {
        const { numVerts, skinWidth, skinHeight } = this.header;

        for (let i = 0; i < numVerts; i++) {
            const onseam = reader.readInt32();
            const s = reader.readInt32();
            const t = reader.readInt32();

            this.texcoords.push({
                onseam: onseam !== 0,
                s: s / skinWidth,
                t: t / skinHeight
            });
        }
    }

    readTriangles(reader) {
        const { numTris } = this.header;

        for (let i = 0; i < numTris; i++) {
            const frontFacing = reader.readInt32();
            const indices = [
                reader.readInt32(),
                reader.readInt32(),
                reader.readInt32()
            ];

            this.triangles.push({
                frontFacing: frontFacing !== 0,
                indices: indices
            });
        }
    }

    readFrames(reader) {
        const { numFrames, numVerts } = this.header;

        for (let i = 0; i < numFrames; i++) {
            const type = reader.readInt32();

            if (type === 0) {
                // Simple frame
                const frame = this.readSingleFrame(reader, numVerts);
                this.frames.push({
                    type: 'single',
                    frame: frame
                });
            } else {
                // Frame group
                const numGroupFrames = reader.readInt32();

                // Read bounding box for group
                const min = this.readVertex(reader);
                const max = this.readVertex(reader);

                // Read frame times
                const times = [];
                for (let j = 0; j < numGroupFrames; j++) {
                    times.push(reader.readFloat32());
                }

                // Read frames
                const groupFrames = [];
                for (let j = 0; j < numGroupFrames; j++) {
                    groupFrames.push(this.readSingleFrame(reader, numVerts));
                }

                this.frames.push({
                    type: 'group',
                    times: times,
                    frames: groupFrames
                });
            }
        }
    }

    readSingleFrame(reader, numVerts) {
        // Read bounding box
        const bboxmin = this.readVertex(reader);
        const bboxmax = this.readVertex(reader);

        // Read frame name
        const name = reader.readString(16);

        // Read vertices
        const vertices = [];
        for (let i = 0; i < numVerts; i++) {
            vertices.push(this.readVertex(reader));
        }

        return {
            name: name,
            bboxmin: bboxmin,
            bboxmax: bboxmax,
            vertices: vertices
        };
    }

    readVertex(reader) {
        // Vertices are stored as 3 bytes (0-255) + 1 byte normal index
        const v = [
            reader.readUint8(),
            reader.readUint8(),
            reader.readUint8()
        ];
        const normalIndex = reader.readUint8();

        return {
            v: v,
            normalIndex: normalIndex
        };
    }

    // Decompress a vertex using scale and origin
    decompressVertex(compressedVertex) {
        const { scale, origin } = this.header;
        return {
            x: compressedVertex.v[0] * scale.x + origin.x,
            y: compressedVertex.v[1] * scale.y + origin.y,
            z: compressedVertex.v[2] * scale.z + origin.z
        };
    }

    // Get frame by index (handles frame groups)
    getFrame(index, time = 0) {
        if (index < 0 || index >= this.frames.length) {
            index = 0;
        }

        const frameData = this.frames[index];

        if (frameData.type === 'single') {
            return frameData.frame;
        }

        // Frame group - find appropriate frame based on time
        const { times, frames } = frameData;
        const duration = times[times.length - 1];
        const t = time % duration;

        for (let i = 0; i < times.length; i++) {
            if (t <= times[i]) {
                return frames[i];
            }
        }

        return frames[0];
    }

    // Get decompressed vertices for a frame
    getFrameVertices(frameIndex, time = 0) {
        const frame = this.getFrame(frameIndex, time);
        return frame.vertices.map(v => this.decompressVertex(v));
    }

    // Get skin data as RGBA
    getSkinRGBA(skinIndex = 0, time = 0) {
        if (skinIndex < 0 || skinIndex >= this.skins.length) {
            skinIndex = 0;
        }

        const skin = this.skins[skinIndex];
        let data;

        if (skin.type === 'single') {
            data = skin.data;
        } else {
            // Animated skin - find appropriate frame
            const duration = skin.times[skin.times.length - 1];
            const t = time % duration;

            for (let i = 0; i < skin.times.length; i++) {
                if (t <= skin.times[i]) {
                    data = skin.data[i];
                    break;
                }
            }

            if (!data) data = skin.data[0];
        }

        return indexedToRGBA(data, skin.width, skin.height);
    }
}

// Pre-computed normal vectors for MDL (Quake uses 162 normals)
export const MDL_NORMALS = [
    [-0.525731, 0.000000, 0.850651],
    [-0.442863, 0.238856, 0.864188],
    [-0.295242, 0.000000, 0.955423],
    [-0.309017, 0.500000, 0.809017],
    [-0.162460, 0.262866, 0.951056],
    [0.000000, 0.000000, 1.000000],
    [0.000000, 0.850651, 0.525731],
    [-0.147621, 0.716567, 0.681718],
    [0.147621, 0.716567, 0.681718],
    [0.000000, 0.525731, 0.850651],
    [0.309017, 0.500000, 0.809017],
    [0.525731, 0.000000, 0.850651],
    [0.295242, 0.000000, 0.955423],
    [0.442863, 0.238856, 0.864188],
    [0.162460, 0.262866, 0.951056],
    [-0.681718, 0.147621, 0.716567],
    [-0.809017, 0.309017, 0.500000],
    [-0.587785, 0.425325, 0.688191],
    [-0.850651, 0.525731, 0.000000],
    [-0.864188, 0.442863, 0.238856],
    [-0.716567, 0.681718, 0.147621],
    [-0.688191, 0.587785, 0.425325],
    [-0.500000, 0.809017, 0.309017],
    [-0.238856, 0.864188, 0.442863],
    [-0.425325, 0.688191, 0.587785],
    [-0.716567, 0.681718, -0.147621],
    [-0.500000, 0.809017, -0.309017],
    [-0.525731, 0.850651, 0.000000],
    [0.000000, 0.850651, -0.525731],
    [-0.238856, 0.864188, -0.442863],
    [0.000000, 0.955423, -0.295242],
    [-0.262866, 0.951056, -0.162460],
    [0.000000, 1.000000, 0.000000],
    [0.000000, 0.955423, 0.295242],
    [-0.262866, 0.951056, 0.162460],
    [0.238856, 0.864188, 0.442863],
    [0.262866, 0.951056, 0.162460],
    [0.500000, 0.809017, 0.309017],
    [0.238856, 0.864188, -0.442863],
    [0.262866, 0.951056, -0.162460],
    [0.500000, 0.809017, -0.309017],
    [0.850651, 0.525731, 0.000000],
    [0.716567, 0.681718, 0.147621],
    [0.716567, 0.681718, -0.147621],
    [0.525731, 0.850651, 0.000000],
    [0.425325, 0.688191, 0.587785],
    [0.864188, 0.442863, 0.238856],
    [0.688191, 0.587785, 0.425325],
    [0.809017, 0.309017, 0.500000],
    [0.681718, 0.147621, 0.716567],
    [0.587785, 0.425325, 0.688191],
    [0.955423, 0.295242, 0.000000],
    [1.000000, 0.000000, 0.000000],
    [0.951056, 0.162460, 0.262866],
    [0.850651, -0.525731, 0.000000],
    [0.955423, -0.295242, 0.000000],
    [0.864188, -0.442863, 0.238856],
    [0.951056, -0.162460, 0.262866],
    [0.809017, -0.309017, 0.500000],
    [0.681718, -0.147621, 0.716567],
    [0.850651, 0.000000, 0.525731],
    [0.864188, 0.442863, -0.238856],
    [0.809017, 0.309017, -0.500000],
    [0.951056, 0.162460, -0.262866],
    [0.525731, 0.000000, -0.850651],
    [0.681718, 0.147621, -0.716567],
    [0.681718, -0.147621, -0.716567],
    [0.850651, 0.000000, -0.525731],
    [0.809017, -0.309017, -0.500000],
    [0.864188, -0.442863, -0.238856],
    [0.951056, -0.162460, -0.262866],
    [0.147621, 0.716567, -0.681718],
    [0.309017, 0.500000, -0.809017],
    [0.425325, 0.688191, -0.587785],
    [0.442863, 0.238856, -0.864188],
    [0.587785, 0.425325, -0.688191],
    [0.688191, 0.587785, -0.425325],
    [-0.147621, 0.716567, -0.681718],
    [-0.309017, 0.500000, -0.809017],
    [0.000000, 0.525731, -0.850651],
    [-0.525731, 0.000000, -0.850651],
    [-0.442863, 0.238856, -0.864188],
    [-0.295242, 0.000000, -0.955423],
    [-0.162460, 0.262866, -0.951056],
    [0.000000, 0.000000, -1.000000],
    [0.295242, 0.000000, -0.955423],
    [0.162460, 0.262866, -0.951056],
    [-0.442863, -0.238856, -0.864188],
    [-0.309017, -0.500000, -0.809017],
    [-0.162460, -0.262866, -0.951056],
    [0.000000, -0.850651, -0.525731],
    [-0.147621, -0.716567, -0.681718],
    [0.147621, -0.716567, -0.681718],
    [0.000000, -0.525731, -0.850651],
    [0.309017, -0.500000, -0.809017],
    [0.442863, -0.238856, -0.864188],
    [0.162460, -0.262866, -0.951056],
    [0.238856, -0.864188, -0.442863],
    [0.500000, -0.809017, -0.309017],
    [0.425325, -0.688191, -0.587785],
    [0.716567, -0.681718, -0.147621],
    [0.688191, -0.587785, -0.425325],
    [0.587785, -0.425325, -0.688191],
    [0.000000, -0.955423, -0.295242],
    [0.000000, -1.000000, 0.000000],
    [0.262866, -0.951056, -0.162460],
    [0.000000, -0.850651, 0.525731],
    [0.000000, -0.955423, 0.295242],
    [0.238856, -0.864188, 0.442863],
    [0.262866, -0.951056, 0.162460],
    [0.500000, -0.809017, 0.309017],
    [0.716567, -0.681718, 0.147621],
    [0.525731, -0.850651, 0.000000],
    [-0.238856, -0.864188, -0.442863],
    [-0.500000, -0.809017, -0.309017],
    [-0.262866, -0.951056, -0.162460],
    [-0.850651, -0.525731, 0.000000],
    [-0.716567, -0.681718, -0.147621],
    [-0.716567, -0.681718, 0.147621],
    [-0.525731, -0.850651, 0.000000],
    [-0.500000, -0.809017, 0.309017],
    [-0.238856, -0.864188, 0.442863],
    [-0.262866, -0.951056, 0.162460],
    [-0.864188, -0.442863, 0.238856],
    [-0.809017, -0.309017, 0.500000],
    [-0.688191, -0.587785, 0.425325],
    [-0.681718, -0.147621, 0.716567],
    [-0.442863, -0.238856, 0.864188],
    [-0.587785, -0.425325, 0.688191],
    [-0.309017, -0.500000, 0.809017],
    [-0.147621, -0.716567, 0.681718],
    [-0.425325, -0.688191, 0.587785],
    [-0.162460, -0.262866, 0.951056],
    [0.442863, -0.238856, 0.864188],
    [0.162460, -0.262866, 0.951056],
    [0.309017, -0.500000, 0.809017],
    [0.147621, -0.716567, 0.681718],
    [0.000000, -0.525731, 0.850651],
    [0.425325, -0.688191, 0.587785],
    [0.587785, -0.425325, 0.688191],
    [0.688191, -0.587785, 0.425325],
    [-0.955423, 0.295242, 0.000000],
    [-0.951056, 0.162460, 0.262866],
    [-1.000000, 0.000000, 0.000000],
    [-0.850651, 0.000000, 0.525731],
    [-0.955423, -0.295242, 0.000000],
    [-0.951056, -0.162460, 0.262866],
    [-0.864188, 0.442863, -0.238856],
    [-0.951056, 0.162460, -0.262866],
    [-0.809017, 0.309017, -0.500000],
    [-0.864188, -0.442863, -0.238856],
    [-0.951056, -0.162460, -0.262866],
    [-0.809017, -0.309017, -0.500000],
    [-0.681718, 0.147621, -0.716567],
    [-0.681718, -0.147621, -0.716567],
    [-0.850651, 0.000000, -0.525731],
    [-0.688191, 0.587785, -0.425325],
    [-0.587785, 0.425325, -0.688191],
    [-0.425325, 0.688191, -0.587785],
    [-0.425325, -0.688191, -0.587785],
    [-0.587785, -0.425325, -0.688191],
    [-0.688191, -0.587785, -0.425325]
];

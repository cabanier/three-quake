/**
 * BinaryReader - Little-endian binary data parser for Quake formats
 */
export class BinaryReader {
    constructor(arrayBuffer) {
        this.buffer = arrayBuffer;
        this.view = new DataView(arrayBuffer);
        this.offset = 0;
    }

    get length() {
        return this.buffer.byteLength;
    }

    get remaining() {
        return this.buffer.byteLength - this.offset;
    }

    seek(offset) {
        this.offset = offset;
    }

    skip(bytes) {
        this.offset += bytes;
    }

    readInt8() {
        const value = this.view.getInt8(this.offset);
        this.offset += 1;
        return value;
    }

    readUint8() {
        const value = this.view.getUint8(this.offset);
        this.offset += 1;
        return value;
    }

    readInt16() {
        const value = this.view.getInt16(this.offset, true);
        this.offset += 2;
        return value;
    }

    readUint16() {
        const value = this.view.getUint16(this.offset, true);
        this.offset += 2;
        return value;
    }

    readInt32() {
        const value = this.view.getInt32(this.offset, true);
        this.offset += 4;
        return value;
    }

    readUint32() {
        const value = this.view.getUint32(this.offset, true);
        this.offset += 4;
        return value;
    }

    readFloat32() {
        const value = this.view.getFloat32(this.offset, true);
        this.offset += 4;
        return value;
    }

    readFloat64() {
        const value = this.view.getFloat64(this.offset, true);
        this.offset += 8;
        return value;
    }

    readBytes(length) {
        const bytes = new Uint8Array(this.buffer, this.offset, length);
        this.offset += length;
        return bytes;
    }

    readString(length) {
        const bytes = this.readBytes(length);
        let str = '';
        for (let i = 0; i < bytes.length; i++) {
            if (bytes[i] === 0) break;
            str += String.fromCharCode(bytes[i]);
        }
        return str;
    }

    readVector3() {
        return {
            x: this.readFloat32(),
            y: this.readFloat32(),
            z: this.readFloat32()
        };
    }

    readVector3Short() {
        return {
            x: this.readInt16(),
            y: this.readInt16(),
            z: this.readInt16()
        };
    }

    // Create a sub-reader for a portion of the buffer
    slice(offset, length) {
        return new BinaryReader(this.buffer.slice(offset, offset + length));
    }

    // Get underlying ArrayBuffer slice
    getBuffer(offset, length) {
        return this.buffer.slice(offset, offset + length);
    }
}

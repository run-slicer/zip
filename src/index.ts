import { type Reader, read, arrayReader, blobReader } from "./reader";
import { type Decompressor, streamDecompressor } from "./decompress";

export interface Commentable {
    comment: string;
    rawComment: Uint8Array;
}

export interface Zip extends Commentable {
    entries: Entry[];
}

export interface Entry extends Commentable {
    blob(type?: string): Promise<Blob>;
    bytes(): Promise<Uint8Array>;
    text(): Promise<string>;

    // "File name" field
    name: string;
    rawName: Uint8Array;
    // Unicode Path Extra Field
    fileName?: string;
    rawFileName?: Uint8Array;

    compressionMethod: number;
    uncompressedSize: number;
    compressedSize: number;
    lastModDate: Date;
    isDirectory: boolean;
    encrypted: boolean;
    externalFileAttributes: number;
    versionMadeBy: number;
}

export interface ReadOptions {
    decoder?: TextDecoder;
    decompressor?: Decompressor;
}

export { Reader, read, Decompressor, streamDecompressor };

// shorthands for the core API

export const readBytes = (b: Uint8Array, options?: ReadOptions): Promise<Zip> => read(arrayReader(b), options);
export const readBlob = (b: Blob, options?: ReadOptions): Promise<Zip> => read(blobReader(b), options);

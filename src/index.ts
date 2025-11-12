import { type Reader, read, arrayReader, blobReader } from "./reader";
import { type Decompressor, streamDecompressor, UnsupportedCompressionMethodError } from "./decompress";

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
    crc32: number;
}

export interface ReadOptions {
    // if you're reading ZIPs with non-UTF-8 filenames/comments, e.g. Shift-JIS
    // defaults to UTF-8
    decoder?: TextDecoder;
    // if you want to decompress anything other than Deflate or you don't have the Compression Streams API
    // defaults to a DecompressionStream-based decompressor
    decompressor?: Decompressor;
    // does not do signature seeking, may be faster for valid ZIPs on e.g. a remote source
    // this will not work for ZIPs with leading junk data
    // defaults to false
    naive?: boolean;
}

export { Reader, read, Decompressor, streamDecompressor, UnsupportedCompressionMethodError };

// shorthands for the core API

export const readBytes = (b: Uint8Array, options?: ReadOptions): Promise<Zip> => read(arrayReader(b), options);
export const readBlob = (b: Blob, options?: ReadOptions): Promise<Zip> => read(blobReader(b), options);

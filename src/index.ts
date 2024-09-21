import { type Reader, read, arrayReader, blobReader } from "./reader";

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

    uncompressedSize: number;
    compressedSize: number;
    lastModDate: Date;
    isDirectory: boolean;
    encrypted: boolean;
    externalFileAttributes: number;
    versionMadeBy: number;
}

export { Reader, read };

// shorthands for the core API

export interface ReadOptions {
    encoding?: string;
}

const read0 = (reader: Reader, options?: ReadOptions): Promise<Zip> => {
    return read(reader, options?.encoding ? new TextDecoder(options.encoding) : undefined);
};

export const readBytes = (b: Uint8Array, options?: ReadOptions): Promise<Zip> => read0(arrayReader(b), options);
export const readBlob = (b: Blob, options?: ReadOptions): Promise<Zip> => read0(blobReader(b), options);

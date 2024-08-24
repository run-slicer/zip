import { type Reader, read, createArrayReader, createBlobReader } from "./reader";

export interface Commentable {
    comment: string;
    commentBytes: Uint8Array;
}

export interface Zip extends Commentable {
    entries: Entry[];
}

export interface Entry extends Commentable {
    blob(type?: string): Promise<Blob>;
    bytes(): Promise<Uint8Array>;
    text(): Promise<string>;

    name: string;
    nameBytes: Uint8Array;
    size: number;
    compressedSize: number;
    lastModDate: Date;
    isDirectory: boolean;
    encrypted: boolean;
    externalFileAttributes: number;
    versionMadeBy: number;
}

export { Reader, read, createArrayReader, createBlobReader };

import { type Reader, read, arrayReader, blobReader } from "./reader";

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

export { Reader, read };

export const readBytes = (b: Uint8Array): Promise<Zip> => read(arrayReader(b));
export const readBlob = (b: Blob): Promise<Zip> => read(blobReader(b));

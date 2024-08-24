export interface Commentable {
    comment: string;
    commentBytes: Uint8Array;
}

export interface Zip extends Commentable {
    entries: Entry[];
}

export interface Entry extends Commentable {
    blob(type?: string): Promise<Blob>;
    arrayBuffer(): Promise<ArrayBuffer>;
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

export interface Reader {
    length(): Promise<number>;
    read(offset: number, size: number): Promise<Uint8Array>;
}

export const read = (reader: Reader): Promise<Zip> => {};

import type { Entry, Zip, ReadOptions } from "./";
import { streamDecompressor } from "./decompress";

export interface Reader {
    length(): Promise<number>;
    read(offset: number, size: number): Promise<Uint8Array>;
    slice(offset: number, size: number): Promise<Blob>;
}

export const arrayReader = (b: Uint8Array): Reader => {
    return {
        async length(): Promise<number> {
            return b.length;
        },
        async read(offset: number, size: number): Promise<Uint8Array> {
            return b.subarray(offset, offset + size);
        },
        async slice(offset: number, size: number): Promise<Blob> {
            return new Blob([this.read(offset, size)]);
        },
    };
};

export const blobReader = (b: Blob): Reader => {
    return {
        async length(): Promise<number> {
            return b.size;
        },
        async read(offset: number, size: number): Promise<Uint8Array> {
            return new Uint8Array(await b.slice(offset, offset + size).arrayBuffer());
        },
        async slice(offset: number, size: number): Promise<Blob> {
            return b.slice(offset, offset + size);
        },
    };
};

const seek = async (reader: Reader, signature: number, initialOffset: number = 0): Promise<number> => {
    const length = await reader.length();

    let chunkOffset = initialOffset;
    while (chunkOffset < length) {
        const buffer = await reader.read(chunkOffset, Math.min(64, length - chunkOffset));
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

        for (let offset = 0; offset < buffer.length; offset += 4) {
            if (view.getUint32(offset, true) !== signature) {
                continue;
            }

            return chunkOffset + offset;
        }
        chunkOffset += buffer.length;
    }

    throw new Error(`Could not find signature 0x${signature.toString(16)}`);
};

const dosDateTimeToDate = (date: number, time: number): Date => {
    const day = date & 0x1f; // 1-31
    const month = ((date >> 5) & 0xf) - 1; // 1-12, 0-11
    const year = ((date >> 9) & 0x7f) + 1980; // 0-128, 1980-2108

    const millisecond = 0;
    const second = (time & 0x1f) * 2; // 0-29, 0-58 (even numbers)
    const minute = (time >> 5) & 0x3f; // 0-59
    const hour = (time >> 11) & 0x1f; // 0-23

    return new Date(year, month, day, hour, minute, second, millisecond);
};

interface ExtraField {
    id: number;
    data: Uint8Array;
}

interface RawEntry {
    zipStart: number;
    rawName?: Uint8Array;
    name?: string;
    rawComment?: Uint8Array;
    comment?: string;
    rawFileName?: Uint8Array;
    fileName?: string;
    versionMadeBy: number;
    versionNeededToExtract: number;
    generalPurposeBitFlag: number;
    compressionMethod: number;
    lastModFileTime: number;
    lastModFileDate: number;
    crc32: number;
    compressedSize: number;
    uncompressedSize: number;
    fileNameLength: number;
    extraFieldLength: number;
    fileCommentLength: number;
    internalFileAttributes: number;
    externalFileAttributes: number;
    relativeOffsetOfLocalHeader: number;
    extraFields?: ExtraField[];
}

const utf8Decoder = new TextDecoder();

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;

interface EntryHeader {
    start: number;
    length: number;
}

const readEntryDataHeader = async (reader: Reader, rawEntry: RawEntry): Promise<EntryHeader> => {
    // if (rawEntry.generalPurposeBitFlag & 0x1) {
    //     throw new Error("Encrypted entries are not supported");
    // }

    // signature may not be at the actual offset (?), seek forwards
    const signatureOffset = await seek(
        reader,
        LOCAL_FILE_HEADER_SIGNATURE,
        rawEntry.zipStart + rawEntry.relativeOffsetOfLocalHeader
    );

    const buffer = await reader.read(signatureOffset, 30);
    const bufferView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    // note: maybe this should be passed in or cached on entry
    // as it's async so there will be at least one tick (not sure about that)
    const totalLength = await reader.length();

    // 0 - Local file header signature = 0x04034b50
    const signature = bufferView.getUint32(0, true);
    if (signature !== LOCAL_FILE_HEADER_SIGNATURE) {
        throw new Error(`Invalid local file header signature (0x${signature.toString(16)})`);
    }

    // all this should be redundant
    // 4 - Version needed to extract (minimum)
    // 6 - General purpose bit flag
    // 8 - Compression method
    // 10 - File last modification time
    // 12 - File last modification date
    // 14 - CRC-32
    // 18 - Compressed size
    // 22 - Uncompressed size
    // 26 - File name length (n)
    const fileNameLength = bufferView.getUint16(26, true);
    // 28 - Extra field length (m)
    const extraFieldLength = bufferView.getUint16(28, true);
    // 30 - File name
    // 30+n - Extra field

    const fileDataStart = signatureOffset + buffer.length + fileNameLength + extraFieldLength;
    /*const fileDataEnd = fileDataStart + rawEntry.compressedSize;
    if (rawEntry.compressedSize !== 0) {
        // bounds check now, because the read streams will probably not complain loud enough.
        // since we're dealing with an unsigned offset plus an unsigned size,
        // we only have 1 thing to check for.
        if (fileDataEnd > totalLength) {
            throw new Error(
                `File data overflows file bounds (${fileDataStart} + ${rawEntry.compressedSize} > ${totalLength})`
            );
        }
    }*/

    return { start: fileDataStart, length: Math.min(rawEntry.compressedSize, totalLength - fileDataStart) };
};

const createEntry = (e: RawEntry, reader: Reader, options: ReadOptions): Entry => {
    return {
        comment: e.comment,
        compressedSize: e.compressedSize,
        externalFileAttributes: e.externalFileAttributes,
        name: e.name,
        rawComment: e.rawComment,
        rawName: e.rawName,
        compressionMethod: e.compressionMethod,
        uncompressedSize: e.uncompressedSize,
        versionMadeBy: e.versionMadeBy,
        lastModDate: dosDateTimeToDate(e.lastModFileDate, e.lastModFileTime),
        isDirectory: e.uncompressedSize === 0 && e.name.endsWith("/"),
        encrypted: !!(e.generalPurposeBitFlag & 0x1) || !!(e.generalPurposeBitFlag & 0x40) /* strong encryption */,
        async blob(type: string = "application/octet-stream"): Promise<Blob> {
            const { start, length } = await readEntryDataHeader(reader, e);
            if (e.compressionMethod === 0) {
                // no compression (stored)
                return reader.slice(start, length);
            }

            if (!options.decompressor) {
                throw new Error(`No decompressor available (method ${e.compressionMethod})`);
            }

            const data = await reader.read(start, length);
            return new Blob([await options.decompressor(e.compressionMethod, data)], { type });
        },
        async bytes(): Promise<Uint8Array> {
            const { start, length } = await readEntryDataHeader(reader, e);
            if (e.compressionMethod === 0) {
                // no compression (stored)
                return reader.read(start, length);
            }

            if (!options.decompressor) {
                throw new Error(`No decompressor available (method ${e.compressionMethod})`);
            }

            return options.decompressor(e.compressionMethod, await reader.read(start, length));
        },
        async text(): Promise<string> {
            return options.decoder!.decode(await this.bytes());
        },
    };
};

const CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE = 0x02014b50;
const ENTRY_HEADER_SIZE = 46;

const readEntries = async (
    reader: Reader,
    options: ReadOptions,
    centralDirectoryOffset: number,
    centralDirectorySize: number,
    rawEntryCount: number,
    comment: string,
    rawComment: Uint8Array
): Promise<Zip> => {
    // archives may have arbitrary data in the beginning,
    // i.e. an executable header for self-extracting ZIPs
    const zipStart = await seek(reader, LOCAL_FILE_HEADER_SIGNATURE);

    // signature may not be at the actual offset (?), seek forwards
    centralDirectoryOffset = await seek(
        reader,
        CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE,
        zipStart + centralDirectoryOffset
    );

    const allEntriesBuffer = await reader.read(centralDirectoryOffset, centralDirectorySize);

    let readEntryCursor = 0;
    const rawEntries: RawEntry[] = [];
    for (let e = 0; e < rawEntryCount; ++e) {
        const entryOffset = allEntriesBuffer.byteOffset + readEntryCursor;

        const remaining = allEntriesBuffer.buffer.byteLength - entryOffset;
        if (remaining < ENTRY_HEADER_SIZE) {
            break; // not enough remaining bytes for a header, skip
        }

        const buffer = new DataView(allEntriesBuffer.buffer, entryOffset, ENTRY_HEADER_SIZE);

        // 0 - Central directory file header signature
        const signature = buffer.getUint32(0, true);
        if (signature !== CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE) {
            throw new Error(`Invalid central directory file header signature (0x${signature.toString(16)})`);
        }

        const rawEntry: RawEntry = {
            zipStart,
            // 4 - Version made by
            versionMadeBy: buffer.getUint16(4, true),
            // 6 - Version needed to extract (minimum)
            versionNeededToExtract: buffer.getUint16(6, true),
            // 8 - General purpose bit flag
            generalPurposeBitFlag: buffer.getUint16(8, true),
            // 10 - Compression method
            compressionMethod: buffer.getUint16(10, true),
            // 12 - File last modification time
            lastModFileTime: buffer.getUint16(12, true),
            // 14 - File last modification date
            lastModFileDate: buffer.getUint16(14, true),
            // 16 - CRC-32
            crc32: buffer.getUint32(16, true),
            // 20 - Compressed size
            compressedSize: buffer.getUint32(20, true),
            // 24 - Uncompressed size
            uncompressedSize: buffer.getUint32(24, true),
            // 28 - File name length (n)
            fileNameLength: buffer.getUint16(28, true),
            // 30 - Extra field length (m)
            extraFieldLength: buffer.getUint16(30, true),
            // 32 - File comment length (k)
            fileCommentLength: buffer.getUint16(32, true),
            // 34 - Disk number where file starts
            // 36 - Internal file attributes
            internalFileAttributes: buffer.getUint16(36, true),
            // 38 - External file attributes
            externalFileAttributes: buffer.getUint32(38, true),
            // 42 - Relative offset of local file header
            relativeOffsetOfLocalHeader: buffer.getUint32(42, true),
        };

        // if (rawEntry.generalPurposeBitFlag & 0x40) {
        //     throw new Error("Strong encryption is not supported");
        // }

        readEntryCursor += ENTRY_HEADER_SIZE;

        const data = allEntriesBuffer.subarray(
            readEntryCursor,
            readEntryCursor + rawEntry.fileNameLength + rawEntry.extraFieldLength + rawEntry.fileCommentLength
        );

        // 46 - File name
        const isUTF8 = (rawEntry.generalPurposeBitFlag & 0x800) !== 0;
        rawEntry.rawName = data.subarray(0, rawEntry.fileNameLength);
        rawEntry.name = (isUTF8 ? utf8Decoder : options.decoder!).decode(rawEntry.rawName);

        // 46+n - Extra field
        const fileCommentStart = rawEntry.fileNameLength + rawEntry.extraFieldLength;
        const extraFieldBuffer = data.subarray(rawEntry.fileNameLength, fileCommentStart);
        const extraFieldView = new DataView(
            extraFieldBuffer.buffer,
            extraFieldBuffer.byteOffset,
            extraFieldBuffer.byteLength
        );
        rawEntry.extraFields = [];

        let i = 0;
        while (i < extraFieldBuffer.length - 3) {
            const headerId = extraFieldView.getUint16(i, true);

            const dataSize = Math.min(extraFieldView.getUint16(i + 2, true), extraFieldBuffer.length);
            const dataStart = i + 4;
            const dataEnd = dataStart + dataSize;
            // if (dataEnd > extraFieldBuffer.length) {
            //     throw new Error("Extra field length exceeds extra field buffer size");
            // }

            rawEntry.extraFields.push({
                id: headerId,
                data: extraFieldBuffer.subarray(dataStart, dataEnd),
            });
            i = dataEnd;
        }

        // 46+n+m - File comment
        rawEntry.rawComment = data.subarray(fileCommentStart, fileCommentStart + rawEntry.fileCommentLength);
        rawEntry.comment = options.decoder!.decode(rawEntry.rawComment);

        readEntryCursor += data.length;

        if (
            rawEntry.uncompressedSize === 0xffffffff ||
            rawEntry.compressedSize === 0xffffffff ||
            rawEntry.relativeOffsetOfLocalHeader === 0xffffffff
        ) {
            // ZIP64 format
            // find the Zip64 Extended Information Extra Field
            const zip64ExtraField = rawEntry.extraFields.find((e) => e.id === 0x0001);
            if (!zip64ExtraField) {
                throw new Error("Expected zip64 extended information extra field");
            }

            const zip64EiefBuffer = new DataView(
                zip64ExtraField.data.buffer,
                zip64ExtraField.data.byteOffset,
                zip64ExtraField.data.byteLength
            );

            let index = 0;
            // 0 - Original Size          8 bytes
            if (rawEntry.uncompressedSize === 0xffffffff) {
                if (index + 8 > zip64EiefBuffer.byteLength) {
                    throw new Error("zip64 extended information extra field does not include uncompressed size");
                }

                rawEntry.uncompressedSize = Number(zip64EiefBuffer.getBigUint64(index, true));
                index += 8;
            }
            // 8 - Compressed Size        8 bytes
            if (rawEntry.compressedSize === 0xffffffff) {
                if (index + 8 > zip64EiefBuffer.byteLength) {
                    throw new Error("zip64 extended information extra field does not include compressed size");
                }

                rawEntry.compressedSize = Number(zip64EiefBuffer.getBigUint64(index, true));
                index += 8;
            }
            // 16 - Relative Header Offset 8 bytes
            if (rawEntry.relativeOffsetOfLocalHeader === 0xffffffff) {
                if (index + 8 > zip64EiefBuffer.byteLength) {
                    throw new Error("zip64 extended information extra field does not include relative header offset");
                }

                rawEntry.relativeOffsetOfLocalHeader = Number(zip64EiefBuffer.getBigUint64(index, true));
                index += 8;
            }
            // 24 - Disk Start Number      4 bytes
        }

        // check for Info-ZIP Unicode Path Extra Field (0x7075)
        // see https://github.com/thejoshwolfe/yauzl/issues/33
        const nameField = rawEntry.extraFields.find(
            (e) =>
                e.id === 0x7075 &&
                e.data.length >= 6 && // too short to be meaningful
                e.data[0] === 1 && // Version       1 byte      version of this extra field, currently 1
                new DataView(e.data.buffer, e.data.byteOffset, e.data.byteLength).getUint32(1, true),
            0 // crc.unsigned(rawEntry.nameBytes)
        ); // NameCRC32     4 bytes     File Name Field CRC32 Checksum
        // > If the CRC check fails, this UTF-8 Path Extra Field should be
        // > ignored and the File Name field in the header should be used instead.
        if (nameField) {
            // UnicodeName Variable UTF-8 version of the entry File Name
            rawEntry.rawFileName = nameField.data.subarray(5);
            rawEntry.fileName = utf8Decoder.decode(rawEntry.rawFileName);
        }

        // validate file size
        if (rawEntry.compressionMethod === 0) {
            let expectedCompressedSize = rawEntry.uncompressedSize;
            if ((rawEntry.generalPurposeBitFlag & 0x1) !== 0) {
                // traditional encryption prefixes the file data with a header
                expectedCompressedSize += 12;
            }
            if (rawEntry.compressedSize !== expectedCompressedSize) {
                rawEntry.compressedSize = expectedCompressedSize;
                // throw new Error(`Compressed size mismatch for stored file: ${rawEntry.compressedSize} != ${expectedCompressedSize}`);
            }
        }
        rawEntries.push(rawEntry);
    }

    return {
        comment,
        rawComment,
        entries: rawEntries.map((e) => createEntry(e, reader, options)),
    };
};

const END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCDR_SIGNATURE = 0x06064b50;

const readZip64CentralDirectory = async (
    reader: Reader,
    options: ReadOptions,
    offset: number,
    comment: string,
    rawComment: Uint8Array
): Promise<Zip> => {
    // ZIP64 end of central directory locator
    const zip64EocdlOffset = offset - 20;

    const eocdlData = await reader.read(zip64EocdlOffset, 20);
    const eocdl = new DataView(eocdlData.buffer, eocdlData.byteOffset, eocdlData.byteLength);

    // 0 - zip64 end of central dir locator signature
    if (eocdl.getUint32(0, true) !== END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE) {
        throw new Error("Invalid zip64 end of central directory locator signature");
    }

    // 4 - number of the disk with the start of the zip64 end of central directory
    // 8 - relative offset of the zip64 end of central directory record
    const zip64EocdrOffset = Number(eocdl.getBigUint64(8, true));
    // 16 - total number of disks

    // ZIP64 end of central directory record
    const zip64EocdrData = await reader.read(zip64EocdrOffset, 56);
    const zip64Eocdr = new DataView(zip64EocdrData.buffer, zip64EocdrData.byteOffset, zip64EocdrData.byteLength);

    // 0 - zip64 end of central dir signature                           4 bytes  (0x06064b50)
    if (zip64Eocdr.getUint32(0, true) !== ZIP64_EOCDR_SIGNATURE) {
        throw new Error("Invalid zip64 end of central directory record signature");
    }
    // 4 - size of zip64 end of central directory record                8 bytes
    // 12 - version made by                                             2 bytes
    // 14 - version needed to extract                                   2 bytes
    // 16 - number of this disk                                         4 bytes
    // 20 - number of the disk with the start of the central directory  4 bytes
    // 24 - total number of entries in the central directory on this disk         8 bytes
    // 32 - total number of entries in the central directory            8 bytes
    const entryCount = Number(zip64Eocdr.getBigUint64(32, true));
    // 40 - size of the central directory                               8 bytes
    const centralDirectorySize = Number(zip64Eocdr.getBigUint64(40, true));
    // 48 - offset of start of central directory with respect to the starting disk number     8 bytes
    const centralDirectoryOffset = Number(zip64Eocdr.getBigUint64(48, true));
    // 56 - zip64 extensible data sector                                (variable size)
    return readEntries(reader, options, centralDirectoryOffset, centralDirectorySize, entryCount, comment, rawComment);
};

const EOCDR_WITHOUT_COMMENT_SIZE = 22;
const MAX_COMMENT_SIZE = 0xffff; // 2-byte size
const EOCDR_SIGNATURE = 0x06054b50;

const findEndOfCentralDirectory = async (reader: Reader, options: ReadOptions, totalLength: number): Promise<Zip> => {
    const size = Math.min(EOCDR_WITHOUT_COMMENT_SIZE + MAX_COMMENT_SIZE, totalLength);
    const readStart = totalLength - size;

    const data = await reader.read(readStart, size);

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let i = size - EOCDR_WITHOUT_COMMENT_SIZE; i >= 0; --i) {
        if (view.getUint32(i, true) !== EOCDR_SIGNATURE) {
            continue;
        }

        // 0 - End of central directory signature
        const eocdr = new DataView(data.buffer, data.byteOffset + i, data.byteLength - i);
        // 4 - Number of this disk
        // const diskNumber = eocdr.getUint16(4, true);
        // if (diskNumber !== 0) {
        //     throw new Error(`Multi-volume ZIP files are not supported (volume ${diskNumber})`);
        // }

        // 6 - Disk where central directory starts
        // 8 - Number of central directory records on this disk
        // 10 - Total number of central directory records
        const entryCount = eocdr.getUint16(10, true);
        // 12 - Size of central directory (bytes)
        const centralDirectorySize = eocdr.getUint32(12, true);
        // 16 - Offset of start of central directory, relative to start of archive
        const centralDirectoryOffset = eocdr.getUint32(16, true);
        // 20 - Comment length
        const commentLength = /* eocdr.getUint16(20, true) */ eocdr.byteLength - EOCDR_WITHOUT_COMMENT_SIZE;
        // const expectedCommentLength = eocdr.byteLength - EOCDR_WITHOUT_COMMENT_SIZE;
        // if (commentLength !== expectedCommentLength) {
        //     throw new Error(`Invalid comment length (expected ${expectedCommentLength}, actual ${commentLength})`);
        // }

        // 22 - Comment
        // the encoding is always cp437.
        const rawComment = new Uint8Array(eocdr.buffer, eocdr.byteOffset + 22, commentLength);
        const comment = options.decoder!.decode(rawComment);

        if (entryCount === 0xffff || centralDirectoryOffset === 0xffffffff) {
            return await readZip64CentralDirectory(reader, options, readStart + i, comment, rawComment);
        } else {
            return await readEntries(
                reader,
                options,
                centralDirectoryOffset,
                centralDirectorySize,
                entryCount,
                comment,
                rawComment
            );
        }
    }

    throw new Error("Could not find end of central directory, maybe not a ZIP file?");
};

export const read = async (reader: Reader, options: ReadOptions = {}): Promise<Zip> => {
    if (!options.decoder) options.decoder = utf8Decoder; // default to UTF-8 decoding
    if (!options.decompressor) options.decompressor = streamDecompressor; // default to Decompression Stream API

    const len = await reader.length();
    if (len > Number.MAX_SAFE_INTEGER) {
        throw new Error(`File too large (size ${len}), only file sizes up to 4503599627370496 bytes are supported`);
    }

    return await findEndOfCentralDirectory(reader, options, len);
};

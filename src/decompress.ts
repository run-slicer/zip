export type Decompressor = (method: number, data: Uint8Array) => Uint8Array | PromiseLike<Uint8Array>;

export const streamDecompressor: Decompressor = async (method, data) => {
    if (method !== 8) {
        // not Deflated
        throw new Error(`Unsupported compression method (${method})`);
    }

    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
};

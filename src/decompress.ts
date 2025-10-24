export type Decompressor = (method: number, data: Uint8Array) => Uint8Array | PromiseLike<Uint8Array>;

// used by the reader, please throw this error when the compression method is not supported
export class UnsupportedCompressionMethodError extends Error {
    constructor(method: number) {
        super(`Unsupported compression method (${method})`);
        this.name = "UnsupportedCompressionMethodError";
    }
}

export const streamDecompressor: Decompressor = async (method, data) => {
    if (method !== 8) {
        // not Deflated
        throw new UnsupportedCompressionMethodError(method);
    }

    const stream = new ReadableStream({
        start(controller) {
            controller.enqueue(data);
            controller.close();
        },
    });

    return new Uint8Array(await new Response(stream.pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
};

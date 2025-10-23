export type Decompressor = (method: number, data: Uint8Array) => Uint8Array | PromiseLike<Uint8Array>;

export const streamDecompressor: Decompressor = async (method, data) => {
    if (method !== 8) {
        // not Deflated
        throw new Error(`Unsupported compression method (${method})`);
    }

    const stream = new ReadableStream({
        start(controller) {
            controller.enqueue(data);
            controller.close();
        },
    });

    return new Uint8Array(await new Response(stream.pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
};

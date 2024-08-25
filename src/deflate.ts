export const inflateRaw = async (input: Uint8Array): Promise<Uint8Array> => {
    const stream = new DecompressionStream("deflate-raw");

    const writer = stream.writable.getWriter();
    await writer.write(input);
    await writer.close();

    const reader = stream.readable.getReader();

    const chunks: Uint8Array[] = [];
    while (true) {
        const { value, done } = await reader.read();
        if (done) {
            break;
        }

        chunks.push(value);
    }

    const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));

    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
};

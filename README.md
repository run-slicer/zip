# zip

Random access ZIP manipulation library based on unzipit.

## "Random access"?

That means you can read files from a ZIP without loading the entire ZIP into memory first.

It will scan the ZIP to get the entries, which will be pretty fast, and then you call `entry.blob()`/`entry.text()`/`entry.bytes()` to read and decompress the contents of a specific entry.
I recommend using the `.blob()` method, as it will just slice off the contents and return them without copying if they're not compressed.

## Usage

```ts
import { readBlob } from "@katana-project/zip";

const file: Blob = ...; // some ZIP file

const zip = await readBlob(file);
for (const entry of zip.entries) {
    if (entry.isDirectory) {
        continue;
    }

    console.log(entry.name);
    console.log(await entry.text());
}
```

Check the [index.ts](./src/index.ts) and [decompress.ts](./src/decompress.ts) files for the full API, it's pretty self-explanatory.

## Motivation

I needed a tiny library to read ZIPs without loading them into memory entirely, unzipit worked fine, but
I had to read ZIPs that were tampered with to make them unreadable by most readers, so I "forked" it to be able to read those ZIPs.

I also rewrote it in TypeScript for better type checking and removed the need for an extra library for decompression, pretty neat.

## Licensing

This project is licensed under the MIT License, just like unzipit and yauzl.

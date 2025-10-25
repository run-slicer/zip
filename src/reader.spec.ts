import { readFileSync, opendirSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { readBytes } from "./";
import { expect } from "chai";

describe("reader", () => {
    const register = (path: string) => {
        const data = new Uint8Array(readFileSync(path));
        it(`read ${path}`, async () => {
            const zip = await readBytes(data /*, { decoder: new TextDecoder("shift-jis") }*/);

            // console.log(zip);
            expect(zip.entries.length).greaterThan(0);
            for (const entry of zip.entries) {
                try {
                    await entry.blob();
                    const bytes = await entry.bytes();
                    if (bytes.length === 0 && !entry.isDirectory) {
                        console.warn(`Entry ${entry.name} has zero bytes`);
                    }
                } catch (e) {
                    console.log(entry);
                    throw e;
                }
            }
        });
    };

    const walk = (path: string) => {
        const dir = opendirSync(path);

        let entry: Dirent | null;
        while ((entry = dir.readSync()) !== null) {
            const childPath = join(path, entry.name);

            if (entry.isFile()) {
                register(childPath);
            } else if (entry.isDirectory()) {
                walk(childPath);
            }
        }

        dir.closeSync();
    };

    walk("./samples");
});

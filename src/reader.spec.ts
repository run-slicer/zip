import { readFileSync, opendirSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { readBytes } from "./";

describe("reader", () => {
    const register = (path: string) => {
        const data = new Uint8Array(readFileSync(path));
        it(`read ${path}`, async () => {
            /*const zip = */ await readBytes(data /*, { encoding: "shift-jis" }*/);

            /*console.log(zip);
            for (const entry of zip.entries) {
                if (entry.name.endsWith(".txt")) {
                    console.log(await entry.text());
                }
            }*/
        });
    };

    const walk = (path: string) => {
        const dir = opendirSync(path);

        let entry: Dirent | null;
        while ((entry = dir.readSync()) !== null) {
            const childPath = join(path, entry.name);

            if (entry.isFile() && entry.name.endsWith(".zip")) {
                register(childPath);
            } else if (entry.isDirectory()) {
                walk(childPath);
            }
        }

        dir.closeSync();
    };

    walk("./samples");
});

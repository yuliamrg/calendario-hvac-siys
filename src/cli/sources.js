import { readCalendarFile } from "./files.js";
import { fileSourceMetadata } from "./source-metadata.js";

export class FileCalendarSource {
  constructor(path, { now = () => new Date().toISOString() } = {}) {
    this.path = path;
    this.now = now;
  }

  async load() {
    const input = await readCalendarFile(this.path);
    return {
      document: input.document,
      input,
      source: fileSourceMetadata(input.document, input, this.now())
    };
  }
}

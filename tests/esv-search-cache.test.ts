import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { readEsvSearchCache, writeEsvSearchCache } from "../lib/esv-search-cache";

describe("local ESV search cache", () => {
  it("restores a serialized index using its versioned key", async () => {
    const factory = new IDBFactory();
    const databaseName = "esv-search-cache-roundtrip";

    expect(await readEsvSearchCache("v1", factory, databaseName)).toBeNull();
    await writeEsvSearchCache("v1", '{"index":"saved"}', factory, databaseName);
    expect(await readEsvSearchCache("v1", factory, databaseName)).toBe('{"index":"saved"}');
    expect(await readEsvSearchCache("v2", factory, databaseName)).toBeNull();
  });
});

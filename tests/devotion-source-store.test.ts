import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import {
  deleteDevotionSource,
  listDevotionSourceDates,
  readDevotionSource,
  writeDevotionSource,
} from "../lib/devotion-source-store";

function page(date: string) {
  return {
    date,
    blob: new Blob([date], { type: "image/jpeg" }),
    width: 900,
    height: 1250,
    savedAt: `${date}T09:00:00.000Z`,
  };
}

describe("kept devotion page store", () => {
  it("returns the page a day was imported from", async () => {
    const factory = new IDBFactory();
    const name = "devotion-sources-roundtrip";

    expect(await readDevotionSource("2026-08-12", factory, name)).toBeNull();
    await writeDevotionSource(page("2026-08-12"), factory, name);

    const stored = await readDevotionSource("2026-08-12", factory, name);
    expect(stored?.width).toBe(900);
    expect(await stored?.blob.text()).toBe("2026-08-12");
    expect(await readDevotionSource("2026-08-13", factory, name)).toBeNull();
  });

  it("lists kept dates without decoding the images", async () => {
    const factory = new IDBFactory();
    const name = "devotion-sources-list";

    await writeDevotionSource(page("2026-08-11"), factory, name);
    await writeDevotionSource(page("2026-08-12"), factory, name);

    expect((await listDevotionSourceDates(factory, name)).sort()).toEqual(["2026-08-11", "2026-08-12"]);
  });

  it("drops the oldest pages once a month has accumulated", async () => {
    const factory = new IDBFactory();
    const name = "devotion-sources-trim";
    const dates: string[] = [];
    for (let day = 0; day < 34; day += 1) {
      const date = new Date(2026, 6, 1 + day);
      dates.push(`2026-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`);
    }

    for (const date of dates) await writeDevotionSource(page(date), factory, name);

    const kept = (await listDevotionSourceDates(factory, name)).sort();
    expect(kept).toEqual(dates.slice(-31));
  });

  it("removes a page when its devotion is cleared", async () => {
    const factory = new IDBFactory();
    const name = "devotion-sources-delete";

    await writeDevotionSource(page("2026-08-12"), factory, name);
    await deleteDevotionSource("2026-08-12", factory, name);
    expect(await readDevotionSource("2026-08-12", factory, name)).toBeNull();
  });
});

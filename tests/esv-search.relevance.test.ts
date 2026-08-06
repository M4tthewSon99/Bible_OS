import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import MiniSearch from "minisearch";
import { beforeAll, describe, expect, it } from "vitest";
import {
  corpusToSearchDocuments,
  createEsvSearchIndex,
  searchEsvIndex,
  type EsvCorpus,
  type EsvSearchDocument,
} from "../lib/esv-search";
import { rememberedWording, singleTypos } from "./fixtures/esv-relevance";

const corpusPath = process.env.ESV_CORPUS_PATH;

describe.skipIf(!corpusPath)("pinned ESV relevance", () => {
  let index: MiniSearch<EsvSearchDocument>;

  beforeAll(() => {
    const corpus = JSON.parse(readFileSync(corpusPath as string, "utf8")) as EsvCorpus;
    const documents = corpusToSearchDocuments(corpus);
    index = createEsvSearchIndex(documents);
  });

  it("ranks remembered wording at the expected verse", () => {
    rememberedWording.forEach(({ query, expectedRef }) => {
      const results = searchEsvIndex(index, query).results;
      expect(results[0]?.ref, query).toBe(expectedRef);
    });
  });

  it("finds single-character typos within the top ten", () => {
    singleTypos.forEach(({ query, expectedRef }) => {
      const results = searchEsvIndex(index, query).results;
      expect(results.slice(0, 10).some((result) => result.ref === expectedRef), query).toBe(true);
    });
  });

  it("keeps warm searches within the desktop latency budget", () => {
    rememberedWording.forEach(({ query }) => searchEsvIndex(index, query));
    const timings = Array.from({ length: 5 }, () => rememberedWording.map(({ query }) => {
      const startedAt = performance.now();
      searchEsvIndex(index, query);
      return performance.now() - startedAt;
    })).flat().sort((left, right) => left - right);
    const p95 = timings[Math.floor((timings.length - 1) * 0.95)];
    expect(p95).toBeLessThan(100);
  });
});

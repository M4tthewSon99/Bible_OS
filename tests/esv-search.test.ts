import { describe, expect, it } from "vitest";
import {
  corpusToSearchDocuments,
  createEsvSearchIndex,
  joinEsvTokens,
  normalizeSearchText,
  searchEsvIndex,
  type EsvCorpus,
} from "../lib/esv-search";

type Token = [string, ...string[]];

const verse = (...parts: string[]): Token[] => parts.map((part) => [part]);

const fixture: EsvCorpus = {
  version: "ESV",
  books: {
    Genesis: [[
      verse("In the", "beginning", ",", "God", "created", "the", "heavens", "and the", "earth", "."),
      verse("The", "earth", "was", "without form", "and", "void", ", and", "darkness", "was", "over", "the", "face", "of the", "deep", "."),
      verse("And", "God", "said", ",", "Let there", "be", "light", ",", "and there was", "light", "."),
      verse("God", "saw", "that the", "light", "was", "good", "."),
    ]],
  },
};

function fixtureIndex() {
  return createEsvSearchIndex(corpusToSearchDocuments(fixture, ["GEN"]));
}

describe("local ESV search", () => {
  it("reconstructs the source tokens without changing displayed punctuation", () => {
    expect(joinEsvTokens(fixture.books.Genesis[0][0])).toBe(
      "In the beginning, God created the heavens and the earth.",
    );
  });

  it("normalizes punctuation and capitalization without dropping stopwords", () => {
    expect(normalizeSearchText('“In the Beginning,”')).toBe("in the beginning");
  });

  it("ranks an exact remembered phrase first", () => {
    const output = searchEsvIndex(fixtureIndex(), "in the beginning");
    expect(output.results[0]).toMatchObject({
      ref: "Genesis 1:1",
      matchKind: "exact-phrase",
    });
  });

  it("matches inflected wording through stemming", () => {
    const output = searchEsvIndex(fixtureIndex(), "creating heavens");
    expect(output.results[0]).toMatchObject({ ref: "Genesis 1:1", matchKind: "all-terms" });
  });

  it("uses prefix matching for an unfinished final term", () => {
    const output = searchEsvIndex(fixtureIndex(), "in the beg");
    expect(output.results[0]).toMatchObject({ ref: "Genesis 1:1", matchKind: "prefix" });
  });

  it("recovers a one-character typo in a long term", () => {
    const output = searchEsvIndex(fixtureIndex(), "beggining");
    expect(output.results[0]).toMatchObject({ ref: "Genesis 1:1", matchKind: "fuzzy" });
  });

  it("returns one range for an exact quotation crossing a verse boundary", () => {
    const output = searchEsvIndex(fixtureIndex(), '"earth the earth"');
    expect(output.results).toHaveLength(1);
    expect(output.results[0]).toMatchObject({
      ref: "Genesis 1:1–2",
      verse: 1,
      verseEnd: 2,
      matchKind: "exact-phrase",
    });
  });

  it("returns no loose matches for a quoted phrase", () => {
    const output = searchEsvIndex(fixtureIndex(), '"light created"');
    expect(output.results).toEqual([]);
  });
});

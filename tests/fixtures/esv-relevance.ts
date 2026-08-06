export interface RelevanceCase {
  query: string;
  expectedRef: string;
}

export const rememberedWording: RelevanceCase[] = [
  { query: "for god so loved the world", expectedRef: "John 3:16" },
  { query: "the lord is my shepherd", expectedRef: "Psalms 23:1" },
  { query: "all things work together for good", expectedRef: "Romans 8:28" },
  { query: "love is patient and kind", expectedRef: "1 Corinthians 13:4" },
  { query: "do not be anxious about anything", expectedRef: "Philippians 4:6" },
  { query: "faith is the assurance of things hoped for", expectedRef: "Hebrews 11:1" },
];

export const singleTypos: RelevanceCase[] = [
  { query: "beggining", expectedRef: "Genesis 1:1" },
  { query: "sheperd", expectedRef: "Psalms 23:1" },
  { query: "resurection and the life", expectedRef: "John 11:25" },
  { query: "righteusness kingdom", expectedRef: "Matthew 6:33" },
];

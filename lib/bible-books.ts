import type { Book } from "./types";

type BookTuple = readonly [
  id: string,
  englishName: string,
  simplifiedChineseName: string,
  chapterCount: number,
  aliases: readonly string[],
];

export const BOOKS = [
  ["GEN", "Genesis", "创世记", 50, ["gen", "ge", "gn"]],
  ["EXO", "Exodus", "出埃及记", 40, ["exo", "ex", "exod"]],
  ["LEV", "Leviticus", "利未记", 27, ["lev", "lv"]],
  ["NUM", "Numbers", "民数记", 36, ["num", "nu", "nm"]],
  ["DEU", "Deuteronomy", "申命记", 34, ["deu", "dt", "deut"]],
  ["JOS", "Joshua", "约书亚记", 24, ["jos", "josh"]],
  ["JDG", "Judges", "士师记", 21, ["jdg", "judg"]],
  ["RUT", "Ruth", "路得记", 4, ["rut", "ru", "ruth"]],
  ["1SA", "1 Samuel", "撒母耳记上", 31, ["1sa", "1sam", "1s"]],
  ["2SA", "2 Samuel", "撒母耳记下", 24, ["2sa", "2sam", "2s"]],
  ["1KI", "1 Kings", "列王纪上", 22, ["1ki", "1kgs", "1k"]],
  ["2KI", "2 Kings", "列王纪下", 25, ["2ki", "2kgs", "2k"]],
  ["1CH", "1 Chronicles", "历代志上", 29, ["1ch", "1chr", "1chron"]],
  ["2CH", "2 Chronicles", "历代志下", 36, ["2ch", "2chr", "2chron"]],
  ["EZR", "Ezra", "以斯拉记", 10, ["ezr", "ezra"]],
  ["NEH", "Nehemiah", "尼希米记", 13, ["neh", "ne"]],
  ["EST", "Esther", "以斯帖记", 10, ["est", "esth"]],
  ["JOB", "Job", "约伯记", 42, ["job", "jb"]],
  ["PSA", "Psalms", "诗篇", 150, ["psa", "ps", "psalm", "psalms"]],
  ["PRO", "Proverbs", "箴言", 31, ["pro", "pr", "prov", "prv"]],
  ["ECC", "Ecclesiastes", "传道书", 12, ["ecc", "ec", "eccl"]],
  ["SNG", "Song of Solomon", "雅歌", 8, ["sng", "song", "songofsolomon", "songofsongs", "cant"]],
  ["ISA", "Isaiah", "以赛亚书", 66, ["isa", "is"]],
  ["JER", "Jeremiah", "耶利米书", 52, ["jer", "je"]],
  ["LAM", "Lamentations", "耶利米哀歌", 5, ["lam", "la"]],
  ["EZK", "Ezekiel", "以西结书", 48, ["ezk", "eze", "ezek"]],
  ["DAN", "Daniel", "但以理书", 12, ["dan", "dn"]],
  ["HOS", "Hosea", "何西阿书", 14, ["hos", "ho"]],
  ["JOL", "Joel", "约珥书", 3, ["jol", "joe", "joel"]],
  ["AMO", "Amos", "阿摩司书", 9, ["amo", "am"]],
  ["OBA", "Obadiah", "俄巴底亚书", 1, ["oba", "ob", "obad"]],
  ["JON", "Jonah", "约拿书", 4, ["jon", "jnh", "jonah"]],
  ["MIC", "Micah", "弥迦书", 7, ["mic", "mi"]],
  ["NAM", "Nahum", "那鸿书", 3, ["nam", "na", "nah"]],
  ["HAB", "Habakkuk", "哈巴谷书", 3, ["hab", "hb"]],
  ["ZEP", "Zephaniah", "西番雅书", 3, ["zep", "zeph"]],
  ["HAG", "Haggai", "哈该书", 2, ["hag", "hg"]],
  ["ZEC", "Zechariah", "撒迦利亚书", 14, ["zec", "zech"]],
  ["MAL", "Malachi", "玛拉基书", 4, ["mal", "ml"]],
  ["MAT", "Matthew", "马太福音", 28, ["mat", "mt", "matt"]],
  ["MRK", "Mark", "马可福音", 16, ["mrk", "mk", "mar", "mark"]],
  ["LUK", "Luke", "路加福音", 24, ["luk", "lk", "luke"]],
  ["JHN", "John", "约翰福音", 21, ["jhn", "jn", "joh", "john"]],
  ["ACT", "Acts", "使徒行传", 28, ["act", "ac", "acts"]],
  ["ROM", "Romans", "罗马书", 16, ["rom", "ro", "rm"]],
  ["1CO", "1 Corinthians", "哥林多前书", 16, ["1co", "1cor"]],
  ["2CO", "2 Corinthians", "哥林多后书", 13, ["2co", "2cor"]],
  ["GAL", "Galatians", "加拉太书", 6, ["gal", "ga"]],
  ["EPH", "Ephesians", "以弗所书", 6, ["eph", "ep"]],
  ["PHP", "Philippians", "腓立比书", 4, ["php", "phil", "phi"]],
  ["COL", "Colossians", "歌罗西书", 4, ["col", "co"]],
  ["1TH", "1 Thessalonians", "帖撒罗尼迦前书", 5, ["1th", "1thess"]],
  ["2TH", "2 Thessalonians", "帖撒罗尼迦后书", 3, ["2th", "2thess"]],
  ["1TI", "1 Timothy", "提摩太前书", 6, ["1ti", "1tim"]],
  ["2TI", "2 Timothy", "提摩太后书", 4, ["2ti", "2tim"]],
  ["TIT", "Titus", "提多书", 3, ["tit", "ti"]],
  ["PHM", "Philemon", "腓利门书", 1, ["phm", "phlm", "philem"]],
  ["HEB", "Hebrews", "希伯来书", 13, ["heb", "he"]],
  ["JAS", "James", "雅各书", 5, ["jas", "jam", "james", "ja"]],
  ["1PE", "1 Peter", "彼得前书", 5, ["1pe", "1pet", "1p"]],
  ["2PE", "2 Peter", "彼得后书", 3, ["2pe", "2pet", "2p"]],
  ["1JN", "1 John", "约翰一书", 5, ["1jn", "1john", "1j"]],
  ["2JN", "2 John", "约翰二书", 1, ["2jn", "2john", "2j"]],
  ["3JN", "3 John", "约翰三书", 1, ["3jn", "3john", "3j"]],
  ["JUD", "Jude", "犹大书", 1, ["jud", "jude", "jde"]],
  ["REV", "Revelation", "启示录", 22, ["rev", "re", "rv"]],
] as const satisfies readonly BookTuple[];

export const MD_DIRS = [
  "01_Genesis", "02_Exodus", "03_Leviticus", "04_Numbers", "05_Deuteronomy", "06_Joshua", "07_Judges", "08_Ruth",
  "09_I_Samuel", "10_II_Samuel", "11_I_Kings", "12_II_Kings", "13_I_Chronicles", "14_II_Chronicles", "15_Ezra",
  "16_Nehemiah", "17_Esther", "18_Job", "19_Psalms", "20_Proverbs", "21_Ecclesiastes", "22_Song_of_Solomon",
  "23_Isaiah", "24_Jeremiah", "25_Lamentations", "26_Ezekiel", "27_Daniel", "28_Hosea", "29_Joel", "30_Amos",
  "31_Obadiah", "32_Jonah", "33_Micah", "34_Nahum", "35_Habakkuk", "36_Zephaniah", "37_Haggai", "38_Zechariah",
  "39_Malachi", "40_Matthew", "41_Mark", "42_Luke", "43_John", "44_Acts", "45_Romans", "46_I_Corinthians",
  "47_II_Corinthians", "48_Galatians", "49_Ephesians", "50_Philippians", "51_Colossians", "52_I_Thessalonians",
  "53_II_Thessalonians", "54_I_Timothy", "55_II_Timothy", "56_Titus", "57_Philemon", "58_Hebrews", "59_James",
  "60_I_Peter", "61_II_Peter", "62_I_John", "63_II_John", "64_III_John", "65_Jude", "66_Revelation_of_John",
] as const;

export const BY_ID: Record<string, Book> = Object.fromEntries(
  BOOKS.map(([id, name, zh, chapters, aliases]) => [id, { id, name, zh, chapters, aliases: [...aliases] }]),
);

export const ORDER: string[] = BOOKS.map(([id]) => id);

interface StructureSection {
  en: string;
  zh: string;
  paras: [number, number][];
}

export const STRUCTURE: Record<string, StructureSection[]> = {
  "MAT/1": [
    { en: "The Line of Jesus the Messiah", zh: "耶稣基督的家谱", paras: [[1, 6], [7, 11], [12, 17]] },
    { en: "The Birth of Jesus", zh: "耶稣降生", paras: [[18, 21], [22, 25]] },
  ],
  "MAT/2": [
    { en: "Visitors from the East", zh: "博士来朝", paras: [[1, 6], [7, 12]] },
    { en: "The Escape to Egypt", zh: "逃往埃及", paras: [[13, 15], [16, 18]] },
    { en: "The Return to Nazareth", zh: "回到拿撒勒", paras: [[19, 23]] },
  ],
  "MAT/3": [
    { en: "John the Baptist Prepares the Way", zh: "施洗约翰预备主的道", paras: [[1, 6], [7, 10], [11, 12]] },
    { en: "The Baptism of Jesus", zh: "耶稣受洗", paras: [[13, 15], [16, 17]] },
  ],
  "MAT/4": [
    { en: "The Testing in the Wilderness", zh: "旷野受试探", paras: [[1, 4], [5, 7], [8, 11]] },
    { en: "Ministry Begins in Galilee", zh: "在加利利传道", paras: [[12, 17]] },
    { en: "The First Disciples", zh: "呼召门徒", paras: [[18, 22]] },
    { en: "Crowds Follow Him", zh: "许多人跟随", paras: [[23, 25]] },
  ],
  "JHN/1": [
    { en: "The Word Became Flesh", zh: "道成了肉身", paras: [[1, 5], [6, 13], [14, 18]] },
    { en: "The Witness of John", zh: "约翰的见证", paras: [[19, 28], [29, 34]] },
    { en: "The First Disciples", zh: "最初的门徒", paras: [[35, 42], [43, 51]] },
  ],
  "JHN/3": [
    { en: "Born from Above", zh: "重生", paras: [[1, 8], [9, 15]] },
    { en: "God So Loved the World", zh: "神爱世人", paras: [[16, 21]] },
    { en: "The Last Witness of John", zh: "约翰最后的见证", paras: [[22, 26], [27, 30], [31, 36]] },
  ],
  "PSA/23": [
    { en: "The Lord Is My Shepherd", zh: "耶和华是我的牧者", paras: [[1, 3], [4, 4], [5, 6]] },
  ],
};

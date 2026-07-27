import { describe, expect, it } from "vitest";
import { flattenBookmarks, toUrlList } from "./bookmarks";

describe("flattenBookmarks", () => {
  it("keeps browser order and records nested folder paths", () => {
    const entries = flattenBookmarks([
      {
        id: "0",
        title: "",
        children: [
          {
            id: "1",
            title: "Bookmarks bar",
            children: [
              { id: "2", title: "Ncurator", url: "https://ncurator.com" },
              {
                id: "3",
                title: "Work",
                children: [
                  { id: "4", title: "GitHub", url: "https://github.com" },
                ],
              },
            ],
          },
        ],
      },
    ]);

    expect(entries).toEqual([
      {
        id: "2",
        title: "Ncurator",
        url: "https://ncurator.com",
        folderPath: "Bookmarks bar",
      },
      {
        id: "4",
        title: "GitHub",
        url: "https://github.com",
        folderPath: "Bookmarks bar / Work",
      },
    ]);
  });

  it("preserves duplicate URLs and uses the URL as an empty title fallback", () => {
    const entries = flattenBookmarks([
      { id: "1", title: "", url: "https://example.com" },
      { id: "2", title: "Example", url: "https://example.com" },
    ]);

    expect(entries).toHaveLength(2);
    expect(entries[0]?.title).toBe("https://example.com");
  });
});

describe("toUrlList", () => {
  it("joins only URLs with a single newline and no trailing newline", () => {
    expect(
      toUrlList([
        { id: "1", title: "A", url: "https://a.test", folderPath: "" },
        { id: "2", title: "B", url: "https://b.test", folderPath: "" },
      ]),
    ).toBe("https://a.test\nhttps://b.test");
  });
});

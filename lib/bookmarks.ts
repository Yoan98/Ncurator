export type BookmarkEntry = {
  id: string;
  title: string;
  url: string;
  folderPath: string;
};

type BookmarkNode = Pick<
  chrome.bookmarks.BookmarkTreeNode,
  "id" | "title" | "url" | "children"
>;

export function flattenBookmarks(
  nodes: BookmarkNode[],
  parentFolders: string[] = [],
): BookmarkEntry[] {
  return nodes.flatMap((node) => {
    if (node.url) {
      return [
        {
          id: node.id,
          title: node.title || node.url,
          url: node.url,
          folderPath: parentFolders.join(" / "),
        },
      ];
    }

    const folders = node.title
      ? [...parentFolders, node.title]
      : parentFolders;

    return flattenBookmarks(node.children ?? [], folders);
  });
}

export async function readBookmarks(): Promise<BookmarkEntry[]> {
  const tree = await new Promise<chrome.bookmarks.BookmarkTreeNode[]>(
    (resolve, reject) => {
      chrome.bookmarks.getTree((nodes) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(nodes);
      });
    },
  );

  return flattenBookmarks(tree);
}

export function toUrlList(entries: BookmarkEntry[]): string {
  return entries.map((entry) => entry.url).join("\n");
}


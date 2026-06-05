/**
 * Tests for DataCollector
 *
 * Covers:
 * - US-02: Property & folder listing
 * - US-03: Datum-Mapping (Frontmatter date → Dateiname), Range-Filter
 * - US-04/05: Dataset-Sammlung über mehrere Properties
 * - Data type normalization (Zahlen, Boolean, Text, Rating)
 */

import { DataCollector } from "../src/DataCollector";
import { TFile, TFolder } from "obsidian";
import { ChartConfig } from "../src/types";
import moment from "moment";

// Make moment available as window.moment (Obsidian global)
(global as any).window = { moment };

// --- Mock factory helpers ---

function makeFile(path: string): TFile {
  return new TFile(path);
}

function makeFolder(path: string, children: (TFile | TFolder)[]): TFolder {
  return new TFolder(path, children);
}

function makeApp(
  folderTree: TFolder,
  frontmatterMap: Record<string, Record<string, unknown>>
) {
  return {
    vault: {
      getRoot: () => folderTree,
      getFolderByPath: (path: string) => {
        const find = (f: TFolder): TFolder | null => {
          if (f.path === path) return f;
          for (const child of f.children) {
            if (child instanceof TFolder) {
              const found = find(child);
              if (found) return found;
            }
          }
          return null;
        };
        return find(folderTree);
      },
    },
    metadataCache: {
      on: () => {},
      getFileCache: (file: TFile) => {
        const fm = frontmatterMap[file.path];
        if (!fm) return null;
        return { frontmatter: fm };
      },
    },
  } as any;
}

// --- Test setup ---

const dailyFiles = [
  makeFile("Daily Notes/2024-01-10.md"),
  makeFile("Daily Notes/2024-01-11.md"),
  makeFile("Daily Notes/2024-01-12.md"),
  makeFile("Daily Notes/2024-01-13.md"),
];

const dailyFolder = makeFolder("Daily Notes", dailyFiles);
const root = makeFolder("/", [dailyFolder]);

const frontmatter: Record<string, Record<string, unknown>> = {
  "Daily Notes/2024-01-10.md": { sleep: 6.5, mood: 7, workout: false },
  "Daily Notes/2024-01-11.md": { sleep: 8.0, mood: 8, workout: true },
  "Daily Notes/2024-01-12.md": { sleep: 7.5, mood: 6, workout: false },
  "Daily Notes/2024-01-13.md": { sleep: 9.0, mood: 9, workout: true },
};

const app = makeApp(root, frontmatter);
const collector = new DataCollector(app);

const baseConfig: ChartConfig = {
  type: "line",
  folder: "Daily Notes",
  properties: ["sleep"],
  dateFormat: "YYYY-MM-DD",
  range: { preset: "all" },
};

// ============================================================
// US-02: Folder & Property Listing
// ============================================================

describe("US-02: Folder and property listing", () => {
  test("getAllFolders returns root and subfolders", () => {
    const folders = collector.getAllFolders();
    expect(folders).toContain("/");
    expect(folders).toContain("Daily Notes");
  });

  test("getFilesInFolder returns only .md files from the folder", () => {
    const files = collector.getFilesInFolder("Daily Notes");
    expect(files).toHaveLength(4);
    files.forEach((f) => expect(f.extension).toBe("md"));
  });

  test("getFilesInFolder returns empty array for non-existent folder", () => {
    const files = collector.getFilesInFolder("Non Existent");
    expect(files).toHaveLength(0);
  });

  test("getPropertiesInFolder returns all unique frontmatter keys", () => {
    const props = collector.getPropertiesInFolder("Daily Notes");
    expect(props).toContain("sleep");
    expect(props).toContain("mood");
    expect(props).toContain("workout");
    expect(props).not.toContain("position"); // Obsidian internal key, filtered out
  });

  test("getPropertiesInFolder returns sorted list", () => {
    const props = collector.getPropertiesInFolder("Daily Notes");
    expect(props).toEqual([...props].sort());
  });
});

// ============================================================
// US-03: Date Mapping — Filename
// ============================================================

describe("US-03: Date mapping via filename", () => {
  test("collectDatasets parses dates from filenames", async () => {
    const datasets = await collector.collectDatasets(baseConfig);
    expect(datasets[0].points).toHaveLength(4);
    const dates = datasets[0].points.map((p) => moment(p.date).format("YYYY-MM-DD"));
    expect(dates).toContain("2024-01-10");
    expect(dates).toContain("2024-01-13");
  });

  test("collectDatasets sorts data points by date ascending", async () => {
    const datasets = await collector.collectDatasets(baseConfig);
    const dates = datasets[0].points.map((p) => p.date.getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i]).toBeGreaterThanOrEqual(dates[i - 1]);
    }
  });
});

// ============================================================
// US-03: Date Mapping — Frontmatter 'date' property (priority)
// ============================================================

describe("US-03: Date mapping via frontmatter 'date' property", () => {
  test("frontmatter date property takes priority over filename", async () => {
    const filesWithDateProp = [makeFile("Notes/note-abc.md")];
    const folderWithDate = makeFolder("Notes", filesWithDateProp);
    const rootWithDate = makeFolder("/", [folderWithDate]);
    const fmWithDate: Record<string, Record<string, unknown>> = {
      "Notes/note-abc.md": { date: "2024-03-15", value: 5 },
    };
    const appWithDate = makeApp(rootWithDate, fmWithDate);
    const c = new DataCollector(appWithDate);

    const datasets = await c.collectDatasets({
      ...baseConfig,
      folder: "Notes",
      properties: ["value"],
    });

    expect(datasets[0].points).toHaveLength(1);
    const date = datasets[0].points[0].date;
    expect(moment(date).format("YYYY-MM-DD")).toBe("2024-03-15");
  });
});

// ============================================================
// US-03: Range Filtering
// ============================================================

describe("US-03: Range filtering", () => {
  test("preset '7d' only includes files from last 7 days", async () => {
    // Use files dated yesterday and 10 days ago
    const yesterday = moment().subtract(1, "day").format("YYYY-MM-DD");
    const tenDaysAgo = moment().subtract(10, "days").format("YYYY-MM-DD");

    const recentFiles = [
      makeFile(`Daily Notes/${yesterday}.md`),
      makeFile(`Daily Notes/${tenDaysAgo}.md`),
    ];
    const recentFolder = makeFolder("Daily Notes", recentFiles);
    const recentRoot = makeFolder("/", [recentFolder]);
    const recentFM: Record<string, Record<string, unknown>> = {
      [`Daily Notes/${yesterday}.md`]: { sleep: 7 },
      [`Daily Notes/${tenDaysAgo}.md`]: { sleep: 6 },
    };
    const recentApp = makeApp(recentRoot, recentFM);
    const c = new DataCollector(recentApp);

    const datasets = await c.collectDatasets({
      ...baseConfig,
      range: { preset: "7d" },
    });

    expect(datasets[0].points).toHaveLength(1);
    expect(datasets[0].points[0].value).toBe(7);
  });

  test("preset 'all' includes all files regardless of date", async () => {
    const datasets = await collector.collectDatasets({
      ...baseConfig,
      range: { preset: "all" },
    });
    expect(datasets[0].points).toHaveLength(4);
  });

  test("custom range from/to filters correctly", async () => {
    const datasets = await collector.collectDatasets({
      ...baseConfig,
      range: { from: "2024-01-11", to: "2024-01-12" },
    });
    expect(datasets[0].points).toHaveLength(2);
    const dates = datasets[0].points.map((p) => moment(p.date).format("YYYY-MM-DD"));
    expect(dates).toContain("2024-01-11");
    expect(dates).toContain("2024-01-12");
    expect(dates).not.toContain("2024-01-10");
    expect(dates).not.toContain("2024-01-13");
  });
});

// ============================================================
// US-04: Multiple chart types — data is chart-type independent
// US-05: Multiple properties
// ============================================================

describe("US-05: Multiple properties (multiple datasets)", () => {
  test("collectDatasets returns one dataset per property", async () => {
    const datasets = await collector.collectDatasets({
      ...baseConfig,
      properties: ["sleep", "mood"],
    });
    expect(datasets).toHaveLength(2);
    expect(datasets[0].property).toBe("sleep");
    expect(datasets[1].property).toBe("mood");
  });

  test("each dataset contains the correct values", async () => {
    const datasets = await collector.collectDatasets({
      ...baseConfig,
      properties: ["sleep", "mood"],
    });
    const sleepValues = datasets[0].points.map((p) => p.value);
    expect(sleepValues).toContain(6.5);
    expect(sleepValues).toContain(8.0);

    const moodValues = datasets[1].points.map((p) => p.value);
    expect(moodValues).toContain(7);
    expect(moodValues).toContain(8);
  });

  test("files without a specific property are skipped for that dataset", async () => {
    const fm: Record<string, Record<string, unknown>> = {
      "Daily Notes/2024-01-10.md": { sleep: 7 },
      "Daily Notes/2024-01-11.md": {}, // missing sleep
      "Daily Notes/2024-01-12.md": { sleep: 8 },
      "Daily Notes/2024-01-13.md": { sleep: 9 },
    };
    const a = makeApp(root, fm);
    const c = new DataCollector(a);
    const datasets = await c.collectDatasets(baseConfig);
    expect(datasets[0].points).toHaveLength(3);
  });
});

// ============================================================
// Data type normalization
// ============================================================

describe("Data type normalization", () => {
  test("number values are passed through as-is", async () => {
    const datasets = await collector.collectDatasets(baseConfig);
    expect(datasets[0].points[0].value).toBe(6.5);
  });

  test("boolean true is normalized to 1", async () => {
    const datasets = await collector.collectDatasets({
      ...baseConfig,
      properties: ["workout"],
    });
    const values = datasets[0].points.map((p) => p.value);
    // 2024-01-10: false→0, 2024-01-11: true→1
    expect(values).toContain(0);
    expect(values).toContain(1);
  });

  test("string numbers are normalized to numbers", async () => {
    const fm: Record<string, Record<string, unknown>> = {
      "Daily Notes/2024-01-10.md": { rating: "8" },
      "Daily Notes/2024-01-11.md": { rating: "9.5" },
      "Daily Notes/2024-01-12.md": { rating: "7" },
      "Daily Notes/2024-01-13.md": { rating: "6" },
    };
    const a = makeApp(root, fm);
    const c = new DataCollector(a);
    const datasets = await c.collectDatasets({ ...baseConfig, properties: ["rating"] });
    expect(datasets[0].points[0].value).toBe(8);
    expect(datasets[0].points[1].value).toBe(9.5);
  });

  test("text values are kept as strings", async () => {
    const fm: Record<string, Record<string, unknown>> = {
      "Daily Notes/2024-01-10.md": { mood: "happy" },
      "Daily Notes/2024-01-11.md": { mood: "tired" },
      "Daily Notes/2024-01-12.md": { mood: "happy" },
      "Daily Notes/2024-01-13.md": { mood: "focused" },
    };
    const a = makeApp(root, fm);
    const c = new DataCollector(a);
    const datasets = await c.collectDatasets({ ...baseConfig, properties: ["mood"] });
    expect(datasets[0].valueType).toBe("text");
  });

  test("getTextFrequencies counts occurrences correctly", async () => {
    const fm: Record<string, Record<string, unknown>> = {
      "Daily Notes/2024-01-10.md": { mood: "happy" },
      "Daily Notes/2024-01-11.md": { mood: "tired" },
      "Daily Notes/2024-01-12.md": { mood: "happy" },
      "Daily Notes/2024-01-13.md": { mood: "focused" },
    };
    const a = makeApp(root, fm);
    const c = new DataCollector(a);
    const datasets = await c.collectDatasets({ ...baseConfig, properties: ["mood"] });
    const freq = c.getTextFrequencies(datasets[0]);
    expect(freq["happy"]).toBe(2);
    expect(freq["tired"]).toBe(1);
    expect(freq["focused"]).toBe(1);
  });

  test("files with no matching frontmatter are excluded gracefully", async () => {
    const fm: Record<string, Record<string, unknown>> = {
      "Daily Notes/2024-01-10.md": { sleep: 7 },
      // other files have no frontmatter at all
    };
    const a = makeApp(root, fm);
    const c = new DataCollector(a);
    const datasets = await c.collectDatasets(baseConfig);
    expect(datasets[0].points).toHaveLength(1);
  });
});

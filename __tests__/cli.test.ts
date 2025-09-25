import { describeOutput } from "../src/exporter.js";
import { parseArguments } from "../src/cli.js";

describe("parseArguments", () => {
  it("requires a repository URL", () => {
    expect(() => parseArguments([])).toThrow(/Usage/);
  });

  it("defaults to text format", () => {
    expect(parseArguments(["https://github.com/acme/repo"]).format).toBe("text");
  });

  it("accepts the --pdf shorthand", () => {
    expect(parseArguments(["--pdf", "https://github.com/acme/repo"]).format).toBe(
      "pdf"
    );
  });

  it("accepts the --format=pdf option", () => {
    expect(
      parseArguments(["--format=pdf", "https://github.com/acme/repo"]).format
    ).toBe("pdf");
  });

  it("accepts the --format pdf syntax", () => {
    expect(parseArguments(["--format", "pdf", "https://github.com/acme/repo"]).format).toBe(
      "pdf"
    );
  });

  it("leaves branch undefined when not provided", () => {
    expect(
      parseArguments(["https://github.com/acme/repo"]).branch
    ).toBeUndefined();
  });

  it("accepts the --branch=feature option", () => {
    expect(
      parseArguments(["--branch=feature", "https://github.com/acme/repo"]).branch
    ).toBe("feature");
  });

  it("accepts the --branch feature syntax", () => {
    expect(
      parseArguments(["--branch", "feature", "https://github.com/acme/repo"]).branch
    ).toBe("feature");
  });

  it("accepts the -b feature shorthand", () => {
    expect(
      parseArguments(["-b", "feature", "https://github.com/acme/repo"]).branch
    ).toBe("feature");
  });

  it("requires a value for --branch", () => {
    expect(() => parseArguments(["--branch"])).toThrow(
      /Missing value for --branch/
    );
  });

  it("rejects unsupported formats", () => {
    expect(() =>
      parseArguments(["--format", "docx", "https://github.com/acme/repo"])
    ).toThrow(/Unsupported format/);
  });

  it("rejects unknown flags", () => {
    expect(() => parseArguments(["--unknown", "repo"])).toThrow(/Unknown option/);
  });
});

describe("describeOutput", () => {
  it("includes extension skip counts", () => {
    const message = describeOutput({
      output: { fullPath: "/tmp/foo.pdf", fileName: "foo.pdf", stream: null as any },
      summary: {
        included: 1,
        skippedBinary: 2,
        skippedLarge: 3,
        skippedExtension: 4,
        total: 10,
        truncatedTree: false,
      },
    });

    expect(message).toMatch(/4 extension-filtered/);
  });
});

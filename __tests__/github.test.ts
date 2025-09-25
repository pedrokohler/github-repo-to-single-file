import { GitHubClient } from "../src/github";
import type { BlobResponse } from "../src/types";

jest.mock("node:timers/promises", () => ({
  setTimeout: jest.fn(() => Promise.resolve()),
}));

declare global {
  // eslint-disable-next-line no-var
  var fetch: jest.Mock;
}

global.fetch = jest.fn();

const createResponse = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Response => {
  const textBody = typeof body === "string" ? body : JSON.stringify(body);
  const response = {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: jest.fn().mockResolvedValue(textBody),
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
  return response;
};

describe("GitHubClient request retries", () => {
  const client = new GitHubClient("token");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("throws immediately when the rate limit is exceeded", async () => {
    const reset = Math.floor(Date.now() / 1000) + 60;
    global.fetch.mockResolvedValueOnce(
      createResponse(403, { message: "rate limit" }, {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(reset),
      })
    );

    await expect(client.getBlob("o", "r", "sha")).rejects.toThrow(/rate limit/i);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries on 5xx responses", async () => {
    const blob: BlobResponse = {
      content: Buffer.from("hello").toString("base64"),
      encoding: "base64",
      size: 5,
    };

    global.fetch
      .mockResolvedValueOnce(createResponse(502, "gateway error"))
      .mockResolvedValueOnce(createResponse(200, blob));

    await expect(client.getBlob("o", "r", "sha")).resolves.toEqual(blob);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("retries on network failures", async () => {
    const blob: BlobResponse = {
      content: Buffer.from("world").toString("base64"),
      encoding: "base64",
      size: 5,
    };

    global.fetch
      .mockRejectedValueOnce(new Error("connection closed"))
      .mockResolvedValueOnce(createResponse(200, blob));

    await expect(client.getBlob("o", "r", "sha")).resolves.toEqual(blob);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

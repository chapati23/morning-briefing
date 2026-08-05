import { afterEach, describe, expect, it } from "bun:test";
import { Storage } from "@google-cloud/storage";
import { Gaxios } from "gaxios";
import { teenyRequest, type RequestPart } from "teeny-request";
import { Readable } from "node:stream";

interface CapturedRequest {
  readonly body: string;
  readonly contentType: string;
  readonly url: string;
}

const servers: Bun.Server<undefined>[] = [];

const createCaptureServer = (): {
  readonly origin: string;
  readonly request: Promise<CapturedRequest>;
} => {
  let captureRequest: (request: CapturedRequest) => void = () => {};
  const request = new Promise<CapturedRequest>((resolve) => {
    captureRequest = resolve;
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (incomingRequest) => {
      captureRequest({
        body: await incomingRequest.text(),
        contentType: incomingRequest.headers.get("content-type") ?? "",
        url: incomingRequest.url,
      });
      return Response.json({ items: [] });
    },
  });
  servers.push(server);

  return {
    origin: `http://${server.hostname}:${server.port}`,
    request,
  };
};

const getMultipartBoundary = (contentType: string): string => {
  const boundary = /boundary=([^;]+)/.exec(contentType)?.[1];
  if (!boundary) throw new Error(`Missing multipart boundary: ${contentType}`);
  return boundary;
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop(true)));
});

describe("patched dependency request paths", () => {
  it("builds gaxios multipart requests with a native UUID boundary", async () => {
    const capture = createCaptureServer();
    const client = new Gaxios();

    await client.request({
      method: "POST",
      multipart: [
        {
          content: "gaxios multipart body",
          headers: { "Content-Type": "text/plain" },
        },
      ],
      responseType: "text",
      url: `${capture.origin}/gaxios`,
    });

    const request = await capture.request;
    const boundary = getMultipartBoundary(request.contentType);
    expect(boundary).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(request.body).toContain(`--${boundary}`);
    expect(request.body).toContain("gaxios multipart body");
  });

  it("builds teeny-request multipart requests with a native UUID boundary", async () => {
    const capture = createCaptureServer();
    const multipart: Array<RequestPart & { "Content-Type": string }> = [
      {
        "Content-Type": "application/json",
        body: '{"kind":"metadata"}',
      },
      {
        "Content-Type": "text/plain",
        body: Readable.from("teeny-request multipart body"),
      },
    ];

    await new Promise<void>((resolve, reject) => {
      teenyRequest(
        {
          headers: {},
          method: "POST",
          multipart,
          uri: `${capture.origin}/teeny-request`,
        },
        (error) => {
          if (error) reject(error);
          else resolve();
        },
      );
    });

    const request = await capture.request;
    const boundary = getMultipartBoundary(request.contentType);
    expect(boundary).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(request.body).toContain(`--${boundary}`);
    expect(request.body).toContain("teeny-request multipart body");
  });

  it("keeps Google Cloud Storage requests compatible with the patched stack", async () => {
    const capture = createCaptureServer();
    const storage = new Storage({
      apiEndpoint: capture.origin,
      projectId: "dependency-patch-test",
      retryOptions: { autoRetry: false },
      useAuthWithCustomEndpoint: false,
    });

    const [buckets] = await storage.getBuckets({ autoPaginate: false });
    const request = await capture.request;

    expect(buckets).toEqual([]);
    expect(new URL(request.url).pathname).toBe("/storage/v1/b");
    expect(new URL(request.url).searchParams.get("project")).toBe(
      "dependency-patch-test",
    );
  });
});

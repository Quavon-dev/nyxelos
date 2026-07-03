import { describe, expect, it } from "bun:test";
import { SafeFetchError, safeFetch } from "./safe-fetch";

/** Every test injects `resolveHostname`/`fetchImpl` so nothing here touches
 * a real DNS server or network — the point of this module is to be
 * hermetically testable without depending on what's actually reachable from
 * the machine running the suite. */
function fakeDns(map: Record<string, string[]>) {
  return async (hostname: string) => {
    const addresses = map[hostname];
    if (!addresses) throw new Error(`getaddrinfo ENOTFOUND ${hostname}`);
    return addresses.map((address) => ({ address }));
  };
}

function fakeFetch(
  handler: (input: URL, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input : new URL(input.toString());
    return handler(url, init);
  }) as typeof fetch;
}

describe("safeFetch — scheme and hostname checks", () => {
  it("allows a public http(s) URL and returns the response text", async () => {
    const result = await safeFetch("https://example.test/data", undefined, {
      resolveHostname: fakeDns({ "example.test": ["93.184.216.34"] }),
      fetchImpl: fakeFetch(() => new Response("hello", { status: 200 })),
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.text).toBe("hello");
  });

  it("blocks non-http(s) schemes", async () => {
    await expect(
      safeFetch("file:///etc/passwd", undefined, {
        resolveHostname: fakeDns({}),
        fetchImpl: fakeFetch(() => new Response("nope")),
      }),
    ).rejects.toThrow(SafeFetchError);
    await expect(
      safeFetch("javascript:alert(1)", undefined, {
        resolveHostname: fakeDns({}),
        fetchImpl: fakeFetch(() => new Response("nope")),
      }),
    ).rejects.toThrow(SafeFetchError);
    await expect(
      safeFetch("data:text/plain;base64,aGk=", undefined, {
        resolveHostname: fakeDns({}),
        fetchImpl: fakeFetch(() => new Response("nope")),
      }),
    ).rejects.toThrow(SafeFetchError);
  });

  it("rejects an invalid URL", async () => {
    await expect(safeFetch("not a url")).rejects.toThrow(SafeFetchError);
  });

  it("blocks localhost by hostname before any DNS lookup", async () => {
    let dnsCalled = false;
    await expect(
      safeFetch("http://localhost:8080/", undefined, {
        resolveHostname: async () => {
          dnsCalled = true;
          return [{ address: "127.0.0.1" }];
        },
        fetchImpl: fakeFetch(() => new Response("nope")),
      }),
    ).rejects.toThrow(SafeFetchError);
    expect(dnsCalled).toBe(false);
  });

  it("blocks a literal loopback IP", async () => {
    await expect(
      safeFetch("http://127.0.0.1/admin", undefined, {
        resolveHostname: fakeDns({}),
        fetchImpl: fakeFetch(() => new Response("nope")),
      }),
    ).rejects.toThrow(SafeFetchError);
  });

  it("blocks literal private RFC1918 IPs", async () => {
    for (const ip of ["10.0.0.5", "172.16.0.5", "192.168.1.1"]) {
      await expect(
        safeFetch(`http://${ip}/`, undefined, {
          resolveHostname: fakeDns({}),
          fetchImpl: fakeFetch(() => new Response("nope")),
        }),
      ).rejects.toThrow(SafeFetchError);
    }
  });

  it("blocks the cloud metadata address", async () => {
    await expect(
      safeFetch("http://169.254.169.254/latest/meta-data/", undefined, {
        resolveHostname: fakeDns({}),
        fetchImpl: fakeFetch(() => new Response("nope")),
      }),
    ).rejects.toThrow(SafeFetchError);
  });

  it("blocks a hostname that DNS-resolves to a private address, even though the literal hostname looks public", async () => {
    let fetchCalled = false;
    await expect(
      safeFetch("http://internal.example.test/", undefined, {
        resolveHostname: fakeDns({ "internal.example.test": ["10.1.2.3"] }),
        fetchImpl: fakeFetch(() => {
          fetchCalled = true;
          return new Response("nope");
        }),
      }),
    ).rejects.toThrow(SafeFetchError);
    expect(fetchCalled).toBe(false);
  });

  it("blocks IPv6 loopback and unique-local addresses", async () => {
    await expect(
      safeFetch("http://[::1]/", undefined, {
        resolveHostname: fakeDns({}),
        fetchImpl: fakeFetch(() => new Response("nope")),
      }),
    ).rejects.toThrow(SafeFetchError);
    await expect(
      safeFetch("http://[fd00::1]/", undefined, {
        resolveHostname: fakeDns({}),
        fetchImpl: fakeFetch(() => new Response("nope")),
      }),
    ).rejects.toThrow(SafeFetchError);
  });
});

describe("safeFetch — redirects", () => {
  it("follows a redirect to another public host and re-validates it", async () => {
    const result = await safeFetch("https://start.test/", undefined, {
      resolveHostname: fakeDns({ "start.test": ["1.2.3.4"], "end.test": ["5.6.7.8"] }),
      fetchImpl: fakeFetch((url) => {
        if (url.hostname === "start.test") {
          return new Response(null, {
            status: 302,
            headers: { location: "https://end.test/final" },
          });
        }
        return new Response("final content", { status: 200 });
      }),
    });
    expect(result.text).toBe("final content");
    expect(result.url).toBe("https://end.test/final");
  });

  it("blocks a redirect that points at a private address", async () => {
    await expect(
      safeFetch("https://start.test/", undefined, {
        resolveHostname: fakeDns({ "start.test": ["1.2.3.4"] }),
        fetchImpl: fakeFetch(
          () =>
            new Response(null, { status: 302, headers: { location: "http://127.0.0.1/steal" } }),
        ),
      }),
    ).rejects.toThrow(SafeFetchError);
  });

  it("caps the number of redirects", async () => {
    let hops = 0;
    await expect(
      safeFetch("https://loop.test/", undefined, {
        maxRedirects: 2,
        resolveHostname: fakeDns({ "loop.test": ["1.2.3.4"] }),
        fetchImpl: fakeFetch(() => {
          hops++;
          return new Response(null, { status: 302, headers: { location: "https://loop.test/" } });
        }),
      }),
    ).rejects.toThrow(/Too many redirects/);
    expect(hops).toBe(3); // initial + 2 allowed redirects before the 3rd is rejected
  });
});

describe("safeFetch — timeout, size limit, non-2xx", () => {
  it("times out a request that never resolves", async () => {
    await expect(
      safeFetch("https://slow.test/", undefined, {
        timeoutMs: 20,
        resolveHostname: fakeDns({ "slow.test": ["1.2.3.4"] }),
        fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
          return await new Promise<Response>((resolve, reject) => {
            const signal = init?.signal;
            signal?.addEventListener("abort", () => reject(new Error("aborted")));
            setTimeout(() => resolve(new Response("too late")), 5_000);
          });
        }) as typeof fetch,
      }),
    ).rejects.toThrow(/timed out/);
  });

  it("rejects a response larger than the configured limit", async () => {
    const big = "x".repeat(1000);
    await expect(
      safeFetch("https://big.test/", undefined, {
        maxResponseBytes: 100,
        resolveHostname: fakeDns({ "big.test": ["1.2.3.4"] }),
        fetchImpl: fakeFetch(() => new Response(big, { status: 200 })),
      }),
    ).rejects.toThrow(/maximum allowed size/);
  });

  it("surfaces a non-2xx response instead of throwing (caller decides)", async () => {
    const result = await safeFetch("https://error.test/", undefined, {
      resolveHostname: fakeDns({ "error.test": ["1.2.3.4"] }),
      fetchImpl: fakeFetch(
        () => new Response("not found", { status: 404, statusText: "Not Found" }),
      ),
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.text).toBe("not found");
  });
});

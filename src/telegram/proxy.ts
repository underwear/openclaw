// @ts-nocheck
import { ProxyAgent, request as undiciRequest } from "undici";
import { wrapFetchWithAbortSignal } from "../infra/fetch.js";

/**
 * Build a fetch-compatible function that tunnels through an HTTP CONNECT proxy.
 *
 * undici's `fetch()` + ProxyAgent is broken with CONNECT-only proxies
 * (the proxy returns 403 because fetch sends a plain HTTP request first).
 * `undici.request()` + ProxyAgent correctly uses HTTP CONNECT tunneling,
 * so we wrap it in a Response to match the fetch() signature.
 */
export function makeProxyFetch(proxyUrl: string): typeof fetch {
  const agent = new ProxyAgent(proxyUrl);

  const proxyFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET");
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers ?? (typeof input !== "string" && !(input instanceof URL) ? input.headers : undefined);
    if (rawHeaders) {
      if (rawHeaders instanceof Headers) {
        rawHeaders.forEach((v, k) => { headers[k] = v; });
      } else if (Array.isArray(rawHeaders)) {
        for (const [k, v] of rawHeaders) headers[k] = v;
      } else {
        Object.assign(headers, rawHeaders);
      }
    }

    const res = await undiciRequest(url, {
      method: method as any,
      headers,
      body: init?.body as any,
      dispatcher: agent,
      signal: init?.signal as any,
    });

    const chunks: Buffer[] = [];
    for await (const chunk of res.body) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);

    const responseHeaders = new Headers();
    for (const [key, val] of Object.entries(res.headers)) {
      if (val != null) {
        const values = Array.isArray(val) ? val : [String(val)];
        for (const v of values) responseHeaders.append(key, v);
      }
    }

    return new Response(body, {
      status: res.statusCode,
      headers: responseHeaders,
    });
  };

  return wrapFetchWithAbortSignal(proxyFetch as typeof fetch);
}

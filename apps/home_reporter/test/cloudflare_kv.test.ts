import { describe, expect, it, vi } from "vitest";
import {
  type CloudflareKvConfig,
  putKvValue,
  readKvConfig,
} from "../src/cloudflare_kv";

const config: CloudflareKvConfig = {
  accountId: "account",
  namespaceId: "namespace",
  token: "token",
};

const env = {
  CLOUDFLARE_ACCOUNT_ID: "account",
  CLOUDFLARE_KV_NAMESPACE_ID: "namespace",
  CLOUDFLARE_API_TOKEN: "token",
};

const okRequest = () =>
  vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(null, { status: 200 })),
  );

describe("putKvValue", () => {
  it("percent-encodingしたキーでTTL付きのURLへPUTする", async () => {
    const request = okRequest();

    await putKvValue(config, "status/2026 11", "payload", 600, request);

    const [input, init] = request.mock.calls[0];
    const url = new URL(String(input));
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account/storage/kv/namespaces/namespace/values/status%2F2026%2011",
    );
    expect(url.searchParams.get("expiration_ttl")).toBe("600");
    expect(init?.method).toBe("PUT");
  });

  it("AuthorizationとContent-Typeを付け、bodyをそのまま送る", async () => {
    const request = okRequest();

    await putKvValue(config, "server_status", "payload", 600, request);

    const [, init] = request.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer token");
    expect(headers.get("Content-Type")).toBe("application/octet-stream");
    expect(init?.body).toBe("payload");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("非2xxならstatusとbodyを含むエラーを投げる", async () => {
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response("quota exceeded", { status: 429 })),
    );

    await expect(
      putKvValue(config, "server_status", "payload", 600, request),
    ).rejects.toThrow("KV write failed with status 429: quota exceeded");
  });
});

describe("readKvConfig", () => {
  it("環境変数からアカウントとnamespaceとtokenを読む", () => {
    expect(readKvConfig(env)).toEqual(config);
  });

  it.each([
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_KV_NAMESPACE_ID",
    "CLOUDFLARE_API_TOKEN",
  ])("%sが無ければ変数名を含むエラーを投げる", (name) => {
    expect(() => readKvConfig({ ...env, [name]: undefined })).toThrow(name);
  });

  it("必須値が空文字なら未設定としてエラーを投げる", () => {
    expect(() => readKvConfig({ ...env, CLOUDFLARE_API_TOKEN: "" })).toThrow(
      "CLOUDFLARE_API_TOKEN",
    );
  });
});

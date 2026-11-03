const REQUEST_TIMEOUT_MS = 10_000;

export type CloudflareKvConfig = {
  accountId: string;
  namespaceId: string;
  token: string;
};

const readRequired = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
};

export const readKvConfig = (env: NodeJS.ProcessEnv): CloudflareKvConfig => ({
  accountId: readRequired(env, "CLOUDFLARE_ACCOUNT_ID"),
  namespaceId: readRequired(env, "CLOUDFLARE_KV_NAMESPACE_ID"),
  token: readRequired(env, "CLOUDFLARE_API_TOKEN"),
});

export const putKvValue = async (
  config: CloudflareKvConfig,
  key: string,
  value: string,
  ttlSeconds: number,
  request: typeof fetch = fetch,
): Promise<void> => {
  const url = new URL(
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/storage/kv/namespaces/${config.namespaceId}/values/${encodeURIComponent(key)}`,
  );
  url.searchParams.set("expiration_ttl", String(ttlSeconds));
  const response = await request(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/octet-stream",
    },
    body: value,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `KV write failed with status ${response.status}: ${await response.text()}`,
    );
  }
};

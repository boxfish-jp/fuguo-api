# fuguo_api

ふぐおに関する情報を返す公開 API と、その API が参照する宅内サーバーの生存記録を管理するリポジトリです。公開 API は Cloudflare Workers で動き、宅内サーバーは 5 分ごとに Cloudflare KV へ生存記録を書き込みます。

## 動作環境

- Nix（flakes）と `pnpm` 11.27.0。`nix develop` で Node.js 24 と `pnpm` が入ります。
- `x86_64-linux` で動作確認済みです。
- Cloudflare アカウント（Workers と KV）が必要です。
- 宅内サーバーは Node.js 22.9 以上で動きます。

## セットアップ

1. 依存をインストールします。

   ```sh
   nix develop
   pnpm install
   ```

2. KV namespace を作成し、表示された ID を `apps/api/wrangler.toml` の `id` に設定します。

   ```sh
   pnpm --filter @fuguo_api/api exec wrangler kv namespace create SERVER_STATUS_KV
   ```

3. `Workers KV Storage Write` 権限だけを持つ API トークンを作成します。

4. `apps/home_reporter/.env` を作成し、手順 2 と 3 で取得した値を設定します。

   ```sh
   CLOUDFLARE_ACCOUNT_ID=<account id>
   CLOUDFLARE_KV_NAMESPACE_ID=<namespace id>
   CLOUDFLARE_API_TOKEN=<api token>
   ```

5. 宅内サーバーを起動します。

   ```sh
   pnpm --filter @fuguo_api/home_reporter start
   ```

6. API をデプロイします。

   ```sh
   pnpm --filter @fuguo_api/api deploy
   ```

## 設定

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | はい | KV を所有するアカウント ID |
| `CLOUDFLARE_KV_NAMESPACE_ID` | はい | 生存記録を書く namespace ID |
| `CLOUDFLARE_API_TOKEN` | はい | `Workers KV Storage Write` 権限のトークン |
| `LIVENESS_INTERVAL_MS` | いいえ | 書き込み間隔（既定 300000） |
| `LIVENESS_TTL_SECONDS` | いいえ | キーの失効秒（既定 600） |

## エンドポイント

`GET /api/server_status` は `{"alive": true}` または `{"alive": false}` を返します。KV にキーが存在すれば `true` です。

## 注意

- 生存記録は KV の `server_status` キーを上書きします。キー名は writer と API の両方に現れるため、変えるときは両方と両テストを同時に変えてください。
- 停止の検知は、最後の書き込みから TTL の 600 秒後になります。KV の反映とキャッシュにより、さらに最大 60 秒ほど遅れることがあります。

# fuguo-api

ふぐおに関する情報を返す公開 API と、その API が参照する宅内サーバーの生存記録、および宅内サーバーが Cloudflare KV に記録する配信 URL を管理するリポジトリです。公開 API は Cloudflare Workers で動き、宅内サーバーは 5 分ごとに Cloudflare KV へ生存記録を書き込み、streamingkit の hub から配信情報を購読して同じく KV に記録します。公開 API は生存記録と配信 URL の両方を参照します。

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
   pnpm --filter @fuguo-api/api exec wrangler kv namespace create HOME_REPORTER_KV
   ```

3. `Workers KV Storage Write` 権限だけを持つ API トークンを作成します。

4. `apps/home-reporter/.env` を作成し、手順 2 と 3 で取得した値を設定します。

   ```sh
   CLOUDFLARE_ACCOUNT_ID=<account id>
   CLOUDFLARE_KV_NAMESPACE_ID=<namespace id>
   CLOUDFLARE_API_TOKEN=<api token>
   ```

5. 宅内サーバーを起動します。

   ```sh
   pnpm --filter @fuguo-api/home-reporter start
   ```

6. API をデプロイします。

   ```sh
   pnpm --filter @fuguo-api/api deploy
   ```

## 配信 URL の記録

home-reporter は streamingkit の hub（既定 `http://localhost:8888`）へ socket.io で接続し、orchestrator が broadcast する `streaming_info` を購読します。niconico と youtube の両方の配信情報が揃ったら、KV の `streaming_urls` キーへサイト別の配信 URL を TTL 付きで書き込みます。

```json
{"niconico":"https://live.nicovideo.jp/watch/lv351748501","youtube":null}
```

- niconico は `streaming_info.streamId`（`lv351748501` のような ID）から `https://live.nicovideo.jp/watch/<streamId>` を組み立てます。
- YouTube は `streaming_info.streamId`（動画 ID）から `https://www.youtube.com/watch?v=<streamId>` を組み立てます。
- 配信していないサイト、または `streamId` が無いサイトは `null` になります。
- 配信 URL が変わったら即座に書き込みます。
- 配信 URL が変わらなくても、メッセージを受信した時点で前回の書き込み試行から `LIVENESS_INTERVAL_MS` 以上経っていれば書き込みます（TTL 更新のため）。書き込みに失敗した場合も、同じ配信 URL のまま次の更新間隔で再試行します。
- hub からメッセージが来ない間は書き込まないため、hub や orchestrator が止まると TTL でキーが消えます。

## Nix での起動

`nix run` で宅内サーバーを起動できます。`apps/home-reporter/.env` は自動では読まれないため、環境変数はシェルから渡します。

```sh
export CLOUDFLARE_ACCOUNT_ID=YOUR_ACCOUNT_ID
export CLOUDFLARE_KV_NAMESPACE_ID=YOUR_NAMESPACE_ID
export CLOUDFLARE_API_TOKEN=YOUR_API_TOKEN
nix run .#home-reporter
```

`YOUR_*` は手元の値に置き換えます。

`nix build` で実行ファイルを取り出せます。上の export を済ませたシェルで実行します。

```sh
nix build .#home-reporter
./result/bin/home-reporter
```

### home-manager

flake の input にこのリポジトリを追加し、ユーザーサービスとして常駐させます。次の例の `x86_64-linux` は動作環境に合わせて変えてください。`home.stateVersion` は home-manager を使い始めたリリースに合わせます（この例は `26.11`）。

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    home-manager.url = "github:nix-community/home-manager";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";
    fuguo-api.url = "github:boxfish-jp/fuguo-api";
  };

  outputs =
    inputs@{
      nixpkgs,
      home-manager,
      ...
    }:
    {
      homeConfigurations."<name>" = home-manager.lib.homeManagerConfiguration {
        pkgs = nixpkgs.legacyPackages.x86_64-linux;
        modules = [
          {
            imports = [ inputs.fuguo-api.homeManagerModules.default ];

            home.username = "<name>";
            home.homeDirectory = "/home/<name>";
            home.stateVersion = "26.11";

            services.home-reporter = {
              enable = true;
              environmentFile = "/run/secrets/home-reporter.env";
              intervalMs = 300000;
              ttlSeconds = 600;
            };
          }
        ];
      };
    };
}
```

例の設定を反映します。

```sh
home-manager switch --flake .#<name>
```

`<name>` はユーザー名に置き換えます。`environmentFile` には `CLOUDFLARE_*` を KEY=VALUE 形式で書いたファイルを指定します。ファイルの所有者をサービス実行ユーザーにし、`chmod 600` で保護します（例: `chown <name> /run/secrets/home-reporter.env && chmod 600 /run/secrets/home-reporter.env`）。`environmentFile` は文字列で指定し、path literal は使わないでください。

`intervalMs` と `ttlSeconds` はそれぞれ `LIVENESS_INTERVAL_MS` と `LIVENESS_TTL_SECONDS` に対応します。上は既定値で、`intervalMs < ttlSeconds * 1000` を満たす必要があります。`streamingKitHubUrl` は `STREAMING_KIT_HUB_URL` に対応し、既定値は `http://localhost:8888` です。

ユーザーサービスはログイン中しか動きません。常駐させるには linger を有効にします。NixOS では `users.users.<name>.linger = true;`、NixOS 以外では `loginctl enable-linger <name>` を設定します。

## 設定

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | はい | KV を所有するアカウント ID |
| `CLOUDFLARE_KV_NAMESPACE_ID` | はい | 生存記録と配信 URL を書く namespace ID |
| `CLOUDFLARE_API_TOKEN` | はい | `Workers KV Storage Write` 権限のトークン |
| `LIVENESS_INTERVAL_MS` | いいえ | 生存記録の書き込み間隔（既定 300000）。`streaming_urls` は変化時に即時、変化がなければこの間隔で更新する |
| `LIVENESS_TTL_SECONDS` | いいえ | キーの失効秒（既定 600）。生存記録と `streaming_urls` の両方に使う |
| `STREAMING_KIT_HUB_URL` | いいえ | streamingkit hub の URL（既定 `http://localhost:8888`）。http または https のみ |

## エンドポイント

`GET /api/server_status` は `{"alive": true}` または `{"alive": false}` を返します。KV にキーが存在すれば `true` です。

`GET /api/streaming_urls` は配信中のサイト別 URL を返します。配信していなければ `null` です。`cacheTtl` により最大 30 秒ほど遅れることがあります。KV の値が壊れている場合や、配信 URL が文字列でない場合は、`console.error` を出して `null` にフォールバックします。

```json
{"niconico":"https://live.nicovideo.jp/watch/lv351748501","youtube":null}
```

```json
null
```

## 注意

- 生存記録は KV の `server_status` キーを上書きします。キー名は writer と API の両方に現れるため、変えるときは両方と両テストを同時に変えてください。
- 配信 URL は KV の `streaming_urls` キーを上書きします。値は niconico と youtube の配信 URL（または null）を持つ JSON です。キー名は writer と API の両方に現れるため、変えるときは両方と両テストを同時に変えてください。片方のサイトの通知だけが止まった場合、そのサイトは最後に受信した値のまま残ります。
- 停止の検知は、最後の書き込みから TTL の 600 秒後になります。KV の反映とキャッシュにより、さらに最大 60 秒ほど遅れることがあります。`streaming_urls` も hub からのメッセージが止まると同じく TTL で消えます。

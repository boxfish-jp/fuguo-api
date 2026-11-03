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
   pnpm --filter @fuguo_api/api exec wrangler kv namespace create HOME_REPORTER_KV
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

## Nix での起動

`nix run` で宅内サーバーを起動できます。`apps/home_reporter/.env` は自動では読まれないため、環境変数はシェルから渡します。

```sh
export CLOUDFLARE_ACCOUNT_ID=YOUR_ACCOUNT_ID
export CLOUDFLARE_KV_NAMESPACE_ID=YOUR_NAMESPACE_ID
export CLOUDFLARE_API_TOKEN=YOUR_API_TOKEN
nix run .#home_reporter
```

`YOUR_*` は手元の値に置き換えます。

`nix build` で実行ファイルを取り出せます。上の export を済ませたシェルで実行します。

```sh
nix build .#home_reporter
./result/bin/home_reporter
```

### home-manager

flake の input にこのリポジトリを追加し、ユーザーサービスとして常駐させます。次の例の `x86_64-linux` は動作環境に合わせて変えてください。`home.stateVersion` は home-manager を使い始めたリリースに合わせます（この例は `26.11`）。

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    home-manager.url = "github:nix-community/home-manager";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";
    fuguo_api.url = "github:boxfish-jp/fuguo_api";
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
            imports = [ inputs.fuguo_api.homeManagerModules.default ];

            home.username = "<name>";
            home.homeDirectory = "/home/<name>";
            home.stateVersion = "26.11";

            services.home_reporter = {
              enable = true;
              environmentFile = "/run/secrets/home_reporter.env";
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

`<name>` はユーザー名に置き換えます。`environmentFile` には `CLOUDFLARE_*` を KEY=VALUE 形式で書いたファイルを指定します。ファイルの所有者をサービス実行ユーザーにし、`chmod 600` で保護します（例: `chown <name> /run/secrets/home_reporter.env && chmod 600 /run/secrets/home_reporter.env`）。`environmentFile` は文字列で指定し、path literal は使わないでください。

`intervalMs` と `ttlSeconds` はそれぞれ `LIVENESS_INTERVAL_MS` と `LIVENESS_TTL_SECONDS` に対応します。上は既定値で、`intervalMs < ttlSeconds * 1000` を満たす必要があります。

ユーザーサービスはログイン中しか動きません。常駐させるには linger を有効にします。NixOS では `users.users.<name>.linger = true;`、NixOS 以外では `loginctl enable-linger <name>` を設定します。

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

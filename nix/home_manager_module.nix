{ self }:

{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.home-reporter;
in
{
  options.services.home-reporter = {
    enable = lib.mkEnableOption "home-reporter";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.home-reporter;
      defaultText = lib.literalExpression "self.packages.${pkgs.stdenv.hostPlatform.system}.home-reporter";
      description = "The home-reporter package to run.";
    };

    environmentFile = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "/run/secrets/home-reporter.env";
      description = ''
        Path to a file containing the Cloudflare credentials as KEY=VALUE
        lines, specified as a string such as
        "/run/secrets/home-reporter.env". systemd specifiers like
        "%h/.config/home-reporter/env" are also accepted.

        Do not use a path literal such as ./secrets.env: it is copied to the
        Nix store, which can expose the secrets world-readable.

        Required when `services.home-reporter.enable = true`. It must define
        CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_KV_NAMESPACE_ID and
        CLOUDFLARE_API_TOKEN. The user running the service must be able to
        read it.
      '';
    };

    intervalMs = lib.mkOption {
      type = lib.types.ints.between 1000 2147483647;
      default = 300000;
      description = "Interval between liveness writes in milliseconds. Sets LIVENESS_INTERVAL_MS.";
    };

    ttlSeconds = lib.mkOption {
      type = lib.types.ints.between 60 2147483647;
      default = 600;
      description = "Expiration of the liveness record in seconds. Sets LIVENESS_TTL_SECONDS.";
    };

    streamingKitHubUrl = lib.mkOption {
      type = lib.types.strMatching "https?://.+";
      default = "http://localhost:8888";
      example = "http://192.168.68.16:8888";
      description = "URL of the streamingkit hub to subscribe to. Sets STREAMING_KIT_HUB_URL.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.environmentFile != null && cfg.environmentFile != "";
        message = "services.home-reporter.environmentFile must be set to a non-empty file path readable by the user running the service.";
      }
      {
        assertion = cfg.intervalMs < cfg.ttlSeconds * 1000;
        message = "services.home-reporter.intervalMs must be less than services.home-reporter.ttlSeconds * 1000.";
      }
    ];

    systemd.user.services.home-reporter = {
      Unit = {
        Description = "home-reporter status and data reporter";
        StartLimitIntervalSec = 300;
        StartLimitBurst = 5;
      };

      Service = {
        ExecStart = lib.getExe cfg.package;
        Environment = [
          "LIVENESS_INTERVAL_MS=${toString cfg.intervalMs}"
          "LIVENESS_TTL_SECONDS=${toString cfg.ttlSeconds}"
          "STREAMING_KIT_HUB_URL=${cfg.streamingKitHubUrl}"
        ];
        Restart = "on-failure";
        RestartSec = "10s";
      }
      // lib.optionalAttrs (cfg.environmentFile != null) {
        EnvironmentFile = toString cfg.environmentFile;
      };

      Install.WantedBy = [ "default.target" ];
    };
  };
}

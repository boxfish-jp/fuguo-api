{ self }:

{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.home_reporter;
in
{
  options.services.home_reporter = {
    enable = lib.mkEnableOption "home_reporter";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.home_reporter;
      defaultText = lib.literalExpression "self.packages.${pkgs.stdenv.hostPlatform.system}.home_reporter";
      description = "The home_reporter package to run.";
    };

    environmentFile = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "/run/secrets/home_reporter.env";
      description = ''
        Path to a file containing the Cloudflare credentials as KEY=VALUE
        lines, specified as a string such as
        "/run/secrets/home_reporter.env". systemd specifiers like
        "%h/.config/home_reporter/env" are also accepted.

        Do not use a path literal such as ./secrets.env: it is copied to the
        Nix store, which can expose the secrets world-readable.

        Required when `services.home_reporter.enable = true`. It must define
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
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.environmentFile != null && cfg.environmentFile != "";
        message = "services.home_reporter.environmentFile must be set to a non-empty file path readable by the user running the service.";
      }
      {
        assertion = cfg.intervalMs < cfg.ttlSeconds * 1000;
        message = "services.home_reporter.intervalMs must be less than services.home_reporter.ttlSeconds * 1000.";
      }
    ];

    systemd.user.services.home_reporter = {
      Unit = {
        Description = "home_reporter liveness recorder";
        StartLimitIntervalSec = 300;
        StartLimitBurst = 5;
      };

      Service = {
        ExecStart = lib.getExe cfg.package;
        Environment = [
          "LIVENESS_INTERVAL_MS=${toString cfg.intervalMs}"
          "LIVENESS_TTL_SECONDS=${toString cfg.ttlSeconds}"
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

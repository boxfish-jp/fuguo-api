{
  description = "fuguo-api";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      ...
    }:
    let
      homeManagerModule = import ./nix/home_manager_module.nix { inherit self; };
    in
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        home-reporter = pkgs.callPackage ./nix/home-reporter.nix {
          nodejs = pkgs.nodejs_24;
        };
        fhs = pkgs.buildFHSEnv {
          name = "dev";
          targetPkgs = _: [
            pkgs.nodejs_24
            pkgs.pnpm_11
            pkgs.turbo
            pkgs.typescript-language-server
            pkgs.nixd
            pkgs.nixfmt
            pkgs.python3
          ];
          runScript = "bash";
        };
      in
      {
        formatter = pkgs.nixfmt-tree;
        devShells.default = pkgs.mkShell {
          packages = [ fhs ];
          shellHook = ''
            if [[ -z $DIRENV_IN_ENVRC ]]; then
              exec ${fhs}/bin/dev
            fi
          '';
        };
        packages = {
          inherit home-reporter;
          default = home-reporter;
        };
        apps = {
          home-reporter = flake-utils.lib.mkApp { drv = home-reporter; };
          default = flake-utils.lib.mkApp { drv = home-reporter; };
        };
      }
    )
    // {
      homeManagerModules = {
        default = homeManagerModule;
        home-reporter = homeManagerModule;
      };
      homeModules = {
        default = homeManagerModule;
        home-reporter = homeManagerModule;
      };
    };
}

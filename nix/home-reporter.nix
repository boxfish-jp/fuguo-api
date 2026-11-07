{
  lib,
  stdenv,
  esbuild,
  makeWrapper,
  nodejs,
  pnpm_11,
  fetchPnpmDeps,
  pnpmConfigHook,
}:

stdenv.mkDerivation (finalAttrs: {
  pname = "home-reporter";
  version = "0.1.0";

  src = ../.;

  pnpmWorkspaces = [ "@fuguo-api/home-reporter" ];

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs)
      pname
      version
      src
      pnpmWorkspaces
      ;
    pnpm = pnpm_11;
    fetcherVersion = 4;
    hash = "sha256-9jnDJNSrzhmjcJB9b+KuZHlDwjlnnEGpLwCnCBHipo4=";
  };

  nativeBuildInputs = [
    esbuild
    makeWrapper
    pnpm_11
    pnpmConfigHook
  ];

  buildPhase = ''
    runHook preBuild
    mkdir -p dist
    esbuild apps/home-reporter/src/index.ts \
      --bundle \
      --format=esm \
      --platform=node \
      --target=node${lib.versions.major nodejs.version} \
      --banner:js='import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' \
      --outfile=dist/index.mjs
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    install -Dm644 dist/index.mjs $out/lib/home-reporter/index.mjs
    makeWrapper ${nodejs}/bin/node $out/bin/home-reporter \
      --add-flags $out/lib/home-reporter/index.mjs
    runHook postInstall
  '';

  meta = {
    description = "Reports home server status and data";
    mainProgram = "home-reporter";
    platforms = nodejs.meta.platforms;
  };
})

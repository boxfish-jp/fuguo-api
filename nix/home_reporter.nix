{
  lib,
  stdenv,
  esbuild,
  makeWrapper,
  nodejs,
}:

stdenv.mkDerivation {
  pname = "home_reporter";
  version = "0.1.0";

  src = ../.;

  nativeBuildInputs = [
    esbuild
    makeWrapper
  ];

  buildPhase = ''
    runHook preBuild
    mkdir -p dist
    esbuild apps/home_reporter/src/index.ts \
      --bundle \
      --format=esm \
      --platform=node \
      --target=node${lib.versions.major nodejs.version} \
      --outfile=dist/index.mjs
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    install -Dm644 dist/index.mjs $out/lib/home_reporter/index.mjs
    makeWrapper ${nodejs}/bin/node $out/bin/home_reporter \
      --add-flags $out/lib/home_reporter/index.mjs
    runHook postInstall
  '';

  meta = {
    description = "Writes the home server liveness record to Cloudflare KV";
    mainProgram = "home_reporter";
    platforms = nodejs.meta.platforms;
  };
}

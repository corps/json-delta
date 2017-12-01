{ pkgs ? import <nixpkgs> { inherit system; },
  system ? builtins.currentSystem,
  nodejs ? pkgs.nodejs }:

with pkgs;
stdenv.mkDerivation {
  name = "json-delta-shell";
  buildInputs = [ nodejs ];

  shellHook = ''
    export PATH=$PWD/node_modules/.bin:$PATH
  '';
}

{ pkgs, config, lib, ... }:

let
  cfg = config.languages.scala;
in
{
  options.languages.scala = {
    enable = lib.mkEnableOption "Enable tools for Scala development.";
  };

  config = lib.mkIf cfg.enable {
    packages = with pkgs; [
      scala
      scala-cli
      coursier
      scalafmt
    ];

    #languages.java.enable = true;

    enterShell = ''
      scala --version
      scala-cli --version
      scalafmt --version
      echo cs version
      cs version
    '';
  };
}

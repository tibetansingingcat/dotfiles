# Letterboxd work machine.
{ lib, ... }: {
  imports = [
    ../../darwin
  ];

  # Copy of Letterboxd/letterboxd-scripts:hosts (develop) plus the macOS
  # defaults. Copied, not linked via environment.etc: sandboxed resolvers
  # (Safari, Chromium) can't follow a symlink into /nix/store, and the
  # networking activation step restores /etc/hosts.before-nix-darwin over it.
  system.activationScripts.etc.text = lib.mkAfter ''
    if [ -L /etc/hosts ] || ! cmp -s ${./etc-hosts} /etc/hosts; then
      rm -f /etc/hosts
      install -m 644 -o root -g wheel ${./etc-hosts} /etc/hosts
    fi
  '';

  homebrew = {
    masApps = {
      "WireGuard" = 1451685025;
      # Safari extensions
      "1Password for Safari" = 1569813296;
    };
    taps = [
      {
        name = "letterboxd/tools";
        clone_target = "git@github.com:letterboxd/homebrew-tools.git";
      }
    ];
    # JDKs are managed by SDKMAN, not homebrew -- see programs.zsh in
    # home-manager/zsh.nix. The temurin@25 and zulu@8 casks that used to live
    # here are replaced by `sdk install java 25.0.3-tem` and
    # `sdk install java 8.0.502-zulu` respectively (same builds). Because
    # onActivation.cleanup = "zap", the next activation on this host will
    # uninstall them, so install the SDKMAN equivalents first.
    casks = [
      "1password"
      "1password-cli"
      "dbeaver-community"
      "steam"
      "zen"
    ];
    brews = [
      "letterboxd/tools/letterboxd-setup"
      "maven"
    ];
  };
}

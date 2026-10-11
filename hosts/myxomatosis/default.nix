# Letterboxd work machine.
{ ... }: {
  imports = [
    ../../darwin
  ];

  # Copy of Letterboxd/letterboxd-scripts:hosts (develop) plus the macOS
  # defaults. The hash is the pre-nix /etc/hosts, so activation may replace it.
  environment.etc."hosts" = {
    source = ./etc-hosts;
    knownSha256Hashes = [
      "45f7a1cfce0e814e8ceabe7f2a08d2dcaacbeb59437abb1df1bf5a8a6e16f24b"
    ];
  };

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

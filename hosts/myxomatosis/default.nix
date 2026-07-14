# Letterboxd work machine.
{ ... }: {
  imports = [
    ../../darwin
  ];

  homebrew = {
    taps = [
      {
        name = "letterboxd/tools";
        clone_target = "git@github.com:letterboxd/homebrew-tools.git";
      }
    ];
    casks = [
      "1password"
      "dbeaver-community"
      "temurin@21"
      "temurin@25"
      "zulu@8"
    ];
    brews = [
      "letterboxd/tools/letterboxd-setup"
      "maven"
    ];
  };
}

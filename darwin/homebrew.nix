{ pkgs, lib, vars, config, ... }: {
  environment = {
    shells = with pkgs; [ bash zsh ];
    systemPackages = [ pkgs.coreutils ];
    systemPath = [ "/opt/homebrew/bin" ];
    pathsToLink = [ "/Applications" ];
  };
  homebrew = {
    enable = true;
    caskArgs.no_quarantine = true;
    global.brewfile = true;
    casks = [ 
      "aldente"
      "anki"
      "balenaetcher"
      "beeper"
      "blender"
      "crossover"
      "discord"
		  "google-drive"
		  "handbrake"
      "insomnia"
		  "jetbrains-toolbox"
      "karabiner-elements"
		  "obs"
      "plex"
		  "raycast"
		  "slack"
      "steam"
		  "telegram"
      "unity-hub"
      "vlc"
      "whisky"
      "zoom"
    ];
    taps = [ 
    ];
    brews = [ 
      "okta-aws-cli"
    ];
    masApps = {
		"Bitwarden" = 1352778147;
	  };
	  onActivation.cleanup = "zap";
	  onActivation.autoUpdate = true;
	  onActivation.upgrade = true;
  };
}

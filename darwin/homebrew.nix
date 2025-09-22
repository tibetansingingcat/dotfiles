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
      "audacity"
      "anki"
      "autodesk-fusion"
      "balenaetcher"
      "blender"
      "beeper"
      "blender"
      "calibre"
      "crossover"
      "discord"
      "dropbox"
      "element"
      #"docker"
      "godot"
      "google-chrome"
      "google-drive"
      "handbrake"
      "insomnia"
      "jetbrains-toolbox"
      "karabiner-elements"
      "keka"
      "librewolf"
      # "neovide"
      "nikitabobko/tap/aerospace"
      "nheko"
      "notion"
      "obs"
      "obsidian"
      "plex"
      "proton-drive"
      "proton-mail"
      "proton-mail-bridge"
      "proton-pass"
      "protonvpn"
      "raycast"
      "slack"
      "spotify"
      "signal"
      "steam"
      "transmission-remote-gui"
      "telegram"
      "unity-hub"
      "utm"
      "visual-studio-code"
      "vlc"
      "whisky"
      "zoom"
    ];
    taps = [
    ];
    brews = [
      "autoconf"
      "automake"
      "bash"
      "ccls"
      "clang-format"
      "diff-so-fancy"
      "ffmpeg"
      "llvm"
      "imagemagick"
      "netatalk"
      "okta-aws-cli"
      "openssl"
      "poetry"
      "pkl"
      "sad"
      "typescript-language-server"
      "yt-dlp"
    ];
    masApps = {
      "Bitwarden" = 1352778147;
    };
    onActivation.cleanup = "zap";
    onActivation.autoUpdate = true;
    onActivation.upgrade = true;
  };
}

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
      "aerospace"
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
      "avro-c"
      "bash"
      "bison"
      "boost"
      "boost@1.85"
      "ccls"
      "clang-format"
      "cmake"
      "cryptography"
      "diff-so-fancy"
      "dos2unix"
      "ffmpeg"
      "gcc"
      "go"
      "grep"
      "isl"
      "jansson"
      "kcat"
      "kubernetes-cli"
      "libmpc"
      "librdkafka"
      "libserdes"
      "llvm"
      "libyaml"
      "lpeg"
      "localstack"
      "lsof"
      "luajit"
      "luv"
      "lzlib"
      "imagemagick"
      "mpfr"
      "minikube"
      "neovim"
      "netatalk"
      "okta-aws-cli"
      "openssl"
      "pipx"
      "poetry"
      "pkgconf"
      "pkl"
      "sad"
      "sql-language-server"
      "terminal-notifier"
      "texinfo"
      "tree-sitter"
      "typescript-language-server"
      "unibilium"
      "utf8proc"
      "yajl"
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

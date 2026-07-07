{ pkgs, lib, vars, config, ... }: {
  environment = {
    shells = with pkgs; [ bash zsh ];
    systemPackages = [ pkgs.coreutils ];
    systemPath = [ "/opt/homebrew/bin" ];
    pathsToLink = [ "/Applications" ];
  };
  homebrew = {
    enable = true;
    global.brewfile = true;
    casks = [
      "aerospace"
      #"aldente"
      #"audacity"
      #"anki"
      #"autodesk-fusion"
      "balenaetcher"
      #"bartender"
      #"blender"
      #"beeper"
      "calibre"
      #"crossover"
      #"discord"
      #"dropbox"
      #"element"
      #"godot"
      #"google-chrome"
      "google-drive"
      "handbrake-app"
      "insomnia"
      "jetbrains-toolbox"
      "karabiner-elements"
      "keka"
      #"letterboxd/tools/letterboxd-setup"
      #"linear-linear"
      "nikitabobko/tap/aerospace"
      "nheko"
      #"notion"
      #"obs"
      #"obsidian"
      #"plex"
      #"proton-drive"
      #"proton-mail"
      #"proton-mail-bridge"
      "proton-pass"
      #"protonvpn"
      "raycast"
      "slack"
      #"spotify"
      "signal"
      #"steam"
      #"telegram"
      "tidal"
      "temurin@21"
      "temurin@25"
      #"transmission-remote-gui"
      #"unity-hub"
      #"utm"
      "visual-studio-code"
      #"vlc"
      #"warp"
      #"whisky"
      #"zoom"
      "zulu@8"
    ];
    taps = [
      "nikitabobko/tap"
      {
        name = "letterboxd/tools";
        clone_target = "git@github.com:letterboxd/homebrew-tools.git";
      }
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
      "dotnet"
      "ffmpeg"
      "gcc"
      "gh"
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
      "nvm"
      "netatalk"
      "okta-aws-cli"
      "openssl"
      "pipx"
      "pnpm"
      "poetry"
      "pkgconf"
      "pkl"
      "sad"
      "sql-language-server"
      "tailwindcss-language-server"
      "terminal-notifier"
      "texinfo"
      "tree-sitter"
      "typescript-language-server"
      "unibilium"
      "utf8proc"
      "uv"
      "yajl"
      "yt-dlp"
    ];
    masApps = {
      #"Bitwarden" = 1352778147;
    };
    onActivation.cleanup = "zap";
    onActivation.autoUpdate = true;
    onActivation.upgrade = true;
  };
}

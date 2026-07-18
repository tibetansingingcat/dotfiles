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
    # Casks common to every machine. Host-specific casks live in
    # hosts/<name>/default.nix and roles/personal/darwin.nix.
    casks = [
      "aerospace"
      "balenaetcher"
      "calibre"
      "claude"
      "google-drive"
      "handbrake-app"
      "insomnia"
      "jetbrains-toolbox"
      "karabiner-elements"
      "keka"
      "nikitabobko/tap/aerospace"
      "nheko"
      "proton-pass"
      "qspace-pro"
      "raycast"
      "slack"
      "signal"
      "visual-studio-code"
    ];
    taps = [
      "nikitabobko/tap"
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
      "mas"
      "luv"
      "lzlib"
      "imagemagick"
      "mpfr"
      "minikube"
      "neovim"
      "nvm"
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
      "Amazon Kindle" = 302584613;
      "Todoist" = 585829637;
      # Safari extensions
      "Noir" = 1592917505;
      "Vimari" = 1480933944;
      "Kagi for Safari" = 1622835804;
      "Ghostery Privacy Ad Blocker" = 6504861501;
      "AdGuard Mini" = 1440147259;
      "Tampermonkey Classic" = 1482490089;
      "Octotree" = 1457450145;
      "Command X" = 6448461551;
      "10ten Japanese Reader" = 1573540634;
    };
    onActivation.cleanup = "zap";
    onActivation.autoUpdate = true;
    onActivation.upgrade = true;
  };
}

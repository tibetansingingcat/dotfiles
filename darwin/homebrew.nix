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
      "anki"
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
      "notion"
      "proton-pass"
      "qspace-pro"
      "raycast"
      "slack"
      "signal"
      "tidal"
      "visual-studio-code"
    ];
    taps = [
      "nikitabobko/tap"
      "rtk-ai/tap"
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
      "opencode"
      "openssl"
      "pipx"
      "pnpm"
      "poetry"
      "pkgconf"
      "pkl"
      # CLI proxy that compresses command output before it reaches an agent's
      # context. Wired into Claude Code as a PreToolUse hook -- see the rtk
      # comment in home-manager/claude-code.nix. Brew rather than nix because
      # it isn't in nixpkgs and ships releases weekly, so onActivation.upgrade
      # keeps it current without hand-bumping a hash. Tap-qualified because
      # homebrew/core now ships an unrelated formula also named `rtk`.
      "rtk-ai/tap/rtk"
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
      "Dato" = 1470584107;
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

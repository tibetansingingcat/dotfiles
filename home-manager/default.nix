{ config, pkgs, lib, vars, nix-colors, ... }:
let
  yabai = "${pkgs.yabai}/bin/yabai";
in
{
  imports = [
    ./kitty.nix
    ./neovim.nix
    ./tmux.nix
    ./zsh.nix
    nix-colors.homeManagerModule
  ];
  colorScheme = nix-colors.colorSchemes."catppuccin-mocha";
  # Don't change this when you change package input. Leave it alone.
  home.stateVersion = "24.11";
  #home.enableNixpkgsReleaseCheck = false;
  # specify my home-manager configs
  home.packages = with pkgs; [
    # Some basics
    coreutils
    curl
    wget
    ripgrep
    fd
    less
    yt-dlp

    # Dev stuff
    # scala
    # sbt
    coursier
    idris2
    jq
    lua
    nodePackages.typescript
    nodejs_22
    purescript
    lazygit
    awscli2
    gh
    reattach-to-user-namespace
    rustup
    actionlint

    # Useful nix related tools
    cachix # adding/managing alternative binary caches hosted by Cachix
    # comma # run software from without installing it
    niv # easy dependency management for nix projects
    nodePackages.node2nix
    nodePackages.eslint
  ] ++ lib.optionals stdenv.isDarwin [
    m-cli # useful macOS CLI commands
  ];

  home.sessionVariables = {
    PAGER = "less";
    CLICLOLOR = 1;
    EDITOR = "nvim";
    NPM_CONFIG_PREFIX = "$HOME/.node_modules";
  };


  # programs.neovim = {
  #   enable = true;
  #   #package = pkgs.neovim-nightly;
  #   vimAlias = true;
  #   vimdiffAlias = true;
  #   withNodeJs = true;
  #   plugins = with pkgs.vimPlugins; [
  #     nvim-treesitter.withAllGrammars
  #   ];
  # };

  programs.ssh = {
    enable = true;
    forwardAgent = true;
    matchBlocks = {
      keychain = {
        host = "*";
        extraOptions = {
          UseKeychain = "yes";
          AddKeysToAgent = "yes";
          IgnoreUnknown = "UseKeychain";
        };
      };
    };
  };

  # Direnv, load and unload environment variables depending on the current directory.
  # https://direnv.net
  # https://rycee.gitlab.io/home-manager/options.html#opt-programs.direnv.enable
  programs.direnv.enable = true;
  programs.direnv.nix-direnv.enable = true;

  # Htop
  # https://rycee.gitlab.io/home-manager/options.html#opt-programs.htop.enable
  programs.htop.enable = true;
  programs.htop.settings.show_program_path = true;
  home.homeDirectory = lib.mkForce "/Users/${vars.user}";

  programs.bat.enable = true;
  programs.bat.config.theme = "TwoDark";
  programs.fzf.enable = true;
  programs.fzf.enableZshIntegration = true;
  programs.eza.enable = true;
  programs.git.enable = true;

  home.activation = {
    # yabai-reloader = ''
    #   run ${yabai} --restart-service
    #   run sudo ${yabai} --load-sa
    # '';
  };

  xdg.configFile = {
    "kitty/launch.conf".text = ''
      launch sh -c "tmux new -t main" -2
    '';
    "yabai/bin/close-window" = {
      source = ./dotfiles/yabai/close-window;
      executable = true;
    };
    "yabai/bin/cycle-floating" = {
      source = ./dotfiles/yabai/cycle-floating;
      executable = true;
    };
    "yabai/bin/focus-direction" = {
      source = ./dotfiles/yabai/focus-direction;
      executable = true;
    };
    "yabai/bin/set-border" = {
      source = ./dotfiles/yabai/set-border;
      executable = true;
    };
    "yabai/bin/on-display-changed" = {
      source = ./dotfiles/yabai/on-display-changed;
      executable = true;
    };
    "yabai/bin/set-display-padding" = {
      source = ./dotfiles/yabai/set-display-padding;
      executable = true;
    };
    "yabai/bin/swap-rotate" = {
      source = ./dotfiles/yabai/swap-rotate;
      executable = true;
    };
    "nvim" = {
      source = ./dotfiles/nvim;
    };
    "skhd/bin/yabai-border" = {
      source = ./dotfiles/skhd/yabai-border;
      executable = true;
    };
    "karabiner/karabiner.json".source = ./dotfiles/karabiner.json;
  };
  programs.starship.enable = true;
  programs.starship.enableZshIntegration = true;
  programs.alacritty = {
    enable = true;
    settings.font.normal.family = "MesloLGS Nerd Font Mono";
    settings.font.size = 16;
  };
  home.file.".inputrc".source = ./dotfiles/inputrc;
  #home.file.".config/nvim".source = ./dotfiles/nvim;
  home.file.".gitconfig".source = ./dotfiles/gitconfig;
  home.file."sxm/.gitconfig".source = ./dotfiles/sxm-gitconfig;
  home.file."Library/Application Support/lazygit/config.yml".source = ./dotfiles/lazygit;
}

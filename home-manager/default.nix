{ config, pkgs, lib, vars, nix-colors, sops-nix, pkgs-unstable, ... }:
let
  yabai = "${pkgs.yabai}/bin/yabai";
in
{
  imports = [
    ./kitty.nix
    ./tmux.nix
    ./zsh.nix
    ./email.nix
    nix-colors.homeManagerModule
    sops-nix.homeManagerModules.sops
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
    nodePackages.pnpm
    nodejs_22
    purescript
    lazygit
    awscli2
    reattach-to-user-namespace
    rustup
    actionlint

    # Useful nix related tools
    cachix # adding/managing alternative binary caches hosted by Cachix
    # comma # run software from without installing it
    niv # easy dependency management for nix projects
    nixd # nix language server for LSP support
    nodePackages.node2nix
    nodePackages.eslint
    #nodePackages.next

    # Secrets management
    age
    sops
  ] ++ lib.optionals stdenv.isDarwin [
    m-cli # useful macOS CLI commands
  ];

  home.sessionVariables = {
    PAGER = "less";
    CLICLOLOR = 1;
    EDITOR = "nvim";
    NPM_CONFIG_PREFIX = "$HOME/.node_modules";
    PNPM_HOME = "$HOME/.local/share/pnpm";
  };


  programs.neovim = {
    enable = true;
    #package = pkgs.neovim-nightly;
    viAlias = true;
    vimAlias = true;
    vimdiffAlias = true;
    withNodeJs = true;
    # Provide only treesitter parsers from Nix (they need valid signatures)
    # LazyVim manages everything else
    extraPackages = with pkgs; [
      # Treesitter CLI for parser management
      tree-sitter
    ];
  };

  programs.ssh = {
    enable = true;
    # Explicitly disable default config to avoid future warnings
    enableDefaultConfig = false;
    matchBlocks = {
      # Apply forwardAgent globally
      "*" = {
        forwardAgent = true;
      };
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

  xdg.configFile = {
    "kitty/launch.conf".text = ''
      launch zsh -c "tmux new-session -A -s main"
    '';
    "nvim" = {
      #source = ./dotfiles/nvim;
      #source = config.lib.file.mkOutOfStoreSymlink ../nvim;
      recursive = true;
      source = config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.dotfiles/nvim";
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
  home.file.".gitconfig".source = ./dotfiles/gitconfig;
  home.file."sxm/.gitconfig".source = ./dotfiles/sxm-gitconfig;
  home.file."Library/Application Support/lazygit/config.yml".source = ./dotfiles/lazygit;

  # Secrets management with sops-nix
  sops = {
    # Path to the age key for decryption (derived from SSH key)
    age.sshKeyPaths = [ "${config.home.homeDirectory}/.ssh/id_ed25519" ];

    # Default secrets file
    defaultSopsFile = ../secrets/secrets.yaml;

    # Define secrets to decrypt
    # Secrets are decrypted to ~/.config/sops-nix/secrets/ by default
    secrets = {
      # Example: decrypt example_api_key from secrets.yaml
      # Access at: config.sops.secrets.example_api_key.path
      "localstack_auth_token" = { };
      "ghe_token" = { };
      "jira_personal_token" = { };
      "jira_username" = { };
      "database/password" = { };
      "protonmail_bridge_password" = { };
      "fastmail_app_password" = { };
    };
  };
}

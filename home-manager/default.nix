{ config, pkgs, lib, vars, nix-colors, sops-nix, pkgs-unstable, ... }:
let
  yabai = "${pkgs.yabai}/bin/yabai";
in
{
  imports = [
    ./claude-code.nix
    ./kitty.nix
    ./tmux.nix
    ./zsh.nix
    ./email.nix
    nix-colors.homeManagerModule
    sops-nix.homeManagerModules.sops
  ];
  colorScheme = nix-colors.colorSchemes."catppuccin-mocha";
  # Don't change this when you change package input. Leave it alone.
  home.stateVersion = "26.05";
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
    nodejs_22
    purescript
    lazygit
    awscli2
    reattach-to-user-namespace
    rustup
    actionlint
    postgresql_17 # psql client (also used by vim-dadbod)

    # Python + libraries used by scripts (e.g. Anki deck generation)
    (python3.withPackages (ps: with ps; [
      genanki
      pyyaml
    ]))

    # Useful nix related tools
    cachix # adding/managing alternative binary caches hosted by Cachix
    niv # easy dependency management for nix projects
    nixd # nix language server for LSP support

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
    PNPM_HOME = "$HOME/.local/share/pnpm";
  };


  programs.neovim = {
    enable = true;
    #package = pkgs.neovim-nightly;
    sideloadInitLua = true;
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

  # Make QSpace Pro the handler for opening folders (Finder itself can't be
  # replaced; this covers folder-opens from other apps). Skips if not installed.
  home.activation.setDefaultFileManager = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    if [ -d "/Applications/QSpace Pro.app" ]; then
      qspaceId=$(/usr/bin/osascript -e 'id of app "QSpace Pro"' 2>/dev/null || true)
      if [ -n "$qspaceId" ]; then
        run ${pkgs.duti}/bin/duti -s "$qspaceId" public.folder viewer || true
      fi
    fi
  '';

  # Print an unmistakable banner at the very end of activation. Ordered after
  # 'sops-nix', which is the last built-in home-manager activation entry, so
  # this is the final thing a successful `darwin-rebuild switch` prints.
  # Suppressed on dry-run activations so it never reports a false success.
  home.activation.switchSucceeded = lib.hm.dag.entryAfter [ "sops-nix" ] ''
    if [[ ! -v DRY_RUN ]]; then
      echo ""
      echo "  ✅  rebuild + switch complete — your configuration is now live."
      echo ""
    fi
  '';

  programs.ssh = {
    enable = true;
    # Explicitly disable default config to avoid future warnings
    enableDefaultConfig = false;
    # matchBlocks (forwardAgent, keychain) live in roles/personal/home.nix
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
    # Writable out-of-store symlink: Karabiner-Elements needs to write back to
    # this file to persist per-device settings (e.g. enabling "Modify events"
    # for a newly connected keyboard). A plain store symlink is read-only, so
    # those GUI toggles silently fail to save. Edits now land in the repo file.
    "karabiner/karabiner.json".source =
      config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.dotfiles/home-manager/dotfiles/karabiner.json";
  };
  programs.starship.enable = true;
  programs.starship.enableZshIntegration = true;
  programs.alacritty = {
    enable = true;
    settings.font.normal.family = "MesloLGS Nerd Font Mono";
    settings.font.size = 16;
  };
  home.file.".inputrc".source = ./dotfiles/inputrc;
  # Referenced by core.excludesfile in dotfiles/gitconfig
  home.file.".gitignore_global".source = ./dotfiles/gitignore_global;
  home.file.".aerospace.toml".source = ./dotfiles/aerospace.toml;
  # .gitconfig and sxm/.gitconfig are host-specific — see roles/personal/home.nix
  home.file."Library/Application Support/lazygit/config.yml".source = ./dotfiles/lazygit;

  # Secrets management with sops-nix
  sops = {
    # Plaintext age key — the SSH key is passphrase-protected and would hang
    # activation waiting for a prompt that darwin-rebuild swallows
    age.keyFile = "${config.home.homeDirectory}/Library/Application Support/sops/age/keys.txt";

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
      "confluence_personal_token" = { };
      "database/password" = { };
      "protonmail_bridge_password" = { };
      "fastmail_app_password" = { };
    };
  };
}

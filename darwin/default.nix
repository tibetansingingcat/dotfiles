{ pkgs, lib, vars, config, ... }: {
  imports = [
    ./homebrew.nix
    ./jankyborders.nix
    ./pam.nix
  ];
  programs.zsh = {
    enable = true;
  };

  # Enable experimental nix command and flakes
  # nix.package = pkgs.nixUnstable;
  environment.systemPackages = with pkgs; [
    delta
    mono
    pam-reattach
    zstd
  ];
  nix.enable = false;
  #nix.extraOptions = ''
  #  auto-optimise-store = true
  #  experimental-features = nix-command flakes
  #'' + lib.optionalString (pkgs.system == "aarch64-darwin") ''
  #  extra-platforms = x86_64-darwin aarch64-darwin
  #'';
  # Keyboard
  system.keyboard.enableKeyMapping = true;
  system.nvram.variables = {
    "boot-args" = "-arm64e_preview_abi";
  };
  environment.etc."sudoers.d/yabai".text = ''
    ${vars.user} ALL = (root) NOPASSWD: ${config.services.yabai.package}/bin/yabai --load-sa
  '';

  # Add ability to used TouchID for sudo authentication
  security.pam = {
    #enableSudoTouchIdAuth = true;
    enableCustomSudoTouchIdAuth = true;
    # Eventually the below line should work
    #enablePamReattach = true;
  };
  # Fonts
  fonts.packages = with pkgs; [
    recursive
    nerdfonts
  ];
  #services.nix-daemon.enable = true;
  #services.karabiner-elements.enable = true;
  nixpkgs.overlays = [
    (self: super: {
      karabiner-elements = super.karabiner-elements.overrideAttrs (old: {
        version = "14.13.0";

        src = super.fetchurl {
          inherit (old.src) url;
          hash = "sha256-gmJwoht/Tfm5qMecmq1N6PSAIfWOqsvuHU8VDJY8bLw=";
        };
      });
    })
  ];
  #nix.configureBuildUsers = true;
  system.defaults = {
    finder.AppleShowAllExtensions = true;
    finder._FXShowPosixPathInTitle = true;
    dock.autohide = true;
    NSGlobalDomain.AppleShowAllExtensions = true;
    NSGlobalDomain.InitialKeyRepeat = 14;
    NSGlobalDomain.KeyRepeat = 1;
    universalaccess.reduceMotion = true;
    WindowManager.StandardHideDesktopIcons = true;
  };
  # backwards compat; don't change
  system.stateVersion = 5;
}

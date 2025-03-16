{
  description = "darwin system";

  inputs = {
    # Package sets
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-24.11-darwin";
    nixpkgs-unstable.url = github:NixOS/nixpkgs/nixpkgs-unstable;

    # Environment/system management
    darwin.url = "github:lnl7/nix-darwin/master";
    darwin.inputs.nixpkgs.follows = "nixpkgs";
    home-manager.url = "github:nix-community/home-manager/release-24.11";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";
    nix-colors.url = "github:misterio77/nix-colors";

    # Simply required for sane management of Firefox on darwin
    firefox-darwin = {
      url = "github:bandithedoge/nixpkgs-firefox-darwin";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    # Like the Arch User Repository, but better :)
    nur.url = "github:nix-community/NUR";
  };

  outputs = { self, darwin, nixpkgs, home-manager, firefox-darwin, nur, nix-colors, ... }@inputs:
    let

      vars = {
        user = "wrose";
        name = "William Rose";
        location = "$HOME/.dotfiles";
        terminal = "kitty";
        editor = "nvim";
      };
      colorScheme = nix-colors.colorSchemes."catppuccin-mocha";

      inherit (darwin.lib) darwinSystem;
      inherit (inputs.nixpkgs.lib) attrValues makeOverridable optionalAttrs singleton;
      #inherit (sde-nix.packages.aarch64-darwin) sde;

      # Configuration for `nixpkgs`
      nixpkgsConfig = {
        config = { allowUnfree = true; };
        overlays = attrValues self.overlays ++ singleton (
          # Sub in x86 version of packages that don't build on Apple Silicon yet
          final: prev: (optionalAttrs (prev.stdenv.system == "aarch64-darwin") {
            inherit (final.pkgs-x86)
              idris2
              nix-index
              niv
              purescript;
          })
        );
      };
    in
    {
      # My `nix-darwin` configs

      darwinConfigurations = rec {
        karmapolice = darwinSystem {
          system = "aarch64-darwin";
          specialArgs = { inherit vars; };
          modules = attrValues self.darwinModules ++ [
            # Main `nix-darwin` config
            ./darwin
            # `home-manager` module
            home-manager.darwinModules.home-manager
            {
              nixpkgs = nixpkgsConfig;
              # `home-manager` config
              home-manager = {
                extraSpecialArgs = { inherit nix-colors vars; };
                useGlobalPkgs = true;
                useUserPackages = true;
                backupFileExtension = "backup";
                users.${vars.user} = ./home-manager;
              };
            }
          ];
        };
        streetspirit = darwinSystem {
          system = "aarch64-darwin";
          specialArgs = { inherit vars; };
          modules = attrValues self.darwinModules ++ [
            # Main `nix-darwin` config
            ./darwin
            # `home-manager` module
            home-manager.darwinModules.home-manager
            {
              nixpkgs = nixpkgsConfig;
              # `home-manager` config
              home-manager = {
                extraSpecialArgs = { inherit nix-colors vars; };
                useGlobalPkgs = true;
                useUserPackages = true;
                backupFileExtension = "backup";
                users.${vars.user} = ./home-manager;
              };
            }
          ];
        };
      };

      # Overlays --------------------------------------------------------------- {{{

      overlays = {
        # Overlays to add various packages into package set
        comma = final: prev: {
          comma = import inputs.comma { inherit (prev) pkgs; };
        };

        firefox-darwin = firefox-darwin.overlay;

        nur = nur.overlay;

        # Overlay useful on Macs with Apple Silicon
        apple-silicon = final: prev: optionalAttrs (prev.stdenv.system == "aarch64-darwin") {
          # Add access to x86 packages system is running Apple Silicon
          pkgs-x86 = import inputs.nixpkgs {
            system = "x86_64-darwin";
            inherit (nixpkgsConfig) config;
          };
        };
      };

      commonModules = {
        colors = import ./home-manager/colors.nix;
      };

      darwinModules = {
        programs-nix-index =
          # Additional configuration for `nix-index` to enable `command-not-found` functionality with Fish.
          { config, lib, vars, pkgs, ... }:

          {
            config = lib.mkIf config.programs.nix-index.enable {
              programs.fish.interactiveShellInit = ''
                function __fish_command_not_found_handler --on-event="fish_command_not_found"
                  ${if config.programs.fish.useBabelfish then ''
                  command_not_found_handle $argv
                  '' else ''
                  ${pkgs.bashInteractive}/bin/bash -c \
                    "source ${config.programs.nix-index.package}/etc/profile.d/command-not-found.sh; command_not_found_handle $argv"
                  ''}
                end
              '';
            };
          };
      };
    };
}

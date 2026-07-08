{
  description = "darwin system";

  inputs = {
    # Package sets
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-26.05-darwin";
    nixpkgs-unstable.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    # Environment/system management
    nix-darwin.url = "github:nix-darwin/nix-darwin/nix-darwin-26.05";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";
    home-manager.url = "github:nix-community/home-manager/release-26.05";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";
    nix-colors.url = "github:misterio77/nix-colors";
    impurity.url = "github:outfoxxed/impurity.nix";
    serena.url = "github:oraios/serena";

    # Claude Code skills (not a flake, just the repo source)
    caveman = {
      url = "github:JuliusBrussee/caveman";
      flake = false;
    };

    # Simply required for sane management of Firefox on darwin
    firefox-darwin = {
      url = "github:bandithedoge/nixpkgs-firefox-darwin";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    # Like the Arch User Repository, but better :)
    nur.url = "github:nix-community/NUR";

    # Secrets management
    sops-nix.url = "github:Mic92/sops-nix";
    sops-nix.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { self, nix-darwin, nixpkgs, home-manager, firefox-darwin, nur, nix-colors, impurity, serena, caveman, sops-nix, ... }@inputs:
    let

      vars = {
        user = "wrose";
        name = "William Rose";
        location = "$HOME/.dotfiles";
        terminal = "kitty";
        editor = "nvim";
      };
      colorScheme = nix-colors.colorSchemes."catppuccin-mocha";

      inherit (nix-darwin.lib) darwinSystem;
      inherit (inputs.nixpkgs.lib) attrValues;

      # Builds a host from ./hosts/<hostname>/{default.nix,home.nix}.
      # Each host module imports the shared ./darwin and ./home-manager
      # configs and layers host-specific extras on top.
      mkDarwinHost = hostname: darwinSystem {
        system = "aarch64-darwin";
        specialArgs = { inherit vars; };
        modules = attrValues self.darwinModules ++ [
          {
            nixpkgs.overlays = [
              (self: super: {
                #nixfmt-latest = nixfmt.packages."x86_64-darwin".nixfmt;
                nodejs = super.nodejs_22;
                # buildGo125Module overlay no longer needed with nixpkgs 26.05
              })
            ];
          }
          # Host-specific `nix-darwin` config (imports ./darwin)
          ./hosts/${hostname}
          # `home-manager` module
          home-manager.darwinModules.home-manager
          {
            nixpkgs = nixpkgsConfig;
            # `home-manager` config
            home-manager = {
              extraSpecialArgs = {
                inherit nix-colors impurity vars sops-nix serena caveman;
                pkgs-unstable = import inputs.nixpkgs-unstable { system = "aarch64-darwin"; config.allowUnfree = true; };
              };
              useGlobalPkgs = true;
              useUserPackages = true;
              backupFileExtension = "backup";
              users.${vars.user} = import ./hosts/${hostname}/home.nix;
            };
          }
          # Secrets management
          sops-nix.darwinModules.sops
        ];
      };

      # Configuration for `nixpkgs`
      nixpkgsConfig = {
        config = { allowUnfree = true; };
        overlays = attrValues self.overlays;
      };
    in
    {
      # My `nix-darwin` configs

      darwinConfigurations = rec {
        karmapolice = mkDarwinHost "karmapolice";
        streetspirit = mkDarwinHost "streetspirit";
        myxomatosis = mkDarwinHost "myxomatosis";
        # Alias for hostname
        Mac = karmapolice;
      };

      # Overlays --------------------------------------------------------------- {{{

      overlays = {
        firefox-darwin = firefox-darwin.overlay;

        nur = nur.overlays.default;
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

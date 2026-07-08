# Personal machine home-manager extras (karmapolice, streetspirit).
# Merged with the shared config in ../../home-manager/default.nix.
{ ... }: {
  home.file.".gitconfig".source = ../../home-manager/dotfiles/gitconfig;
  home.file."sxm/.gitconfig".source = ../../home-manager/dotfiles/sxm-gitconfig;

  programs.ssh.matchBlocks = {
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
}
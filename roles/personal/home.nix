# Personal machine home-manager extras (karmapolice, streetspirit).
# Merged with the shared config in ../../home-manager/default.nix.
{ ... }: {
  home.file.".gitconfig".source = ../../home-manager/dotfiles/gitconfig;
  home.file."sxm/.gitconfig".source = ../../home-manager/dotfiles/sxm-gitconfig;

  programs.zsh.initContent = ''
    [ -r "$HOME/.sde/profile/profile.sh" ] && source "$HOME/.sde/profile/profile.sh"
  '';

  programs.ssh.settings."*" = {
    ForwardAgent = true;
    UseKeychain = "yes";
    AddKeysToAgent = "yes";
    IgnoreUnknown = "UseKeychain";
  };
}
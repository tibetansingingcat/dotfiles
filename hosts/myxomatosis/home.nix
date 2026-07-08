# Letterboxd work machine.
{ ... }: {
  imports = [
    ../../home-manager
  ];

  # Personal gitconfig with work email. Git takes the last value it
  # reads, so [user] here overrides the email from the included file.
  home.file.".gitconfig".text = ''
    [include]
    	path = ${../../home-manager/dotfiles/gitconfig}

    [user]
    	email = will@letterboxd.com
  '';
}
# Personal machine extras (karmapolice, streetspirit).
# Merged with the common homebrew config in ../../darwin/homebrew.nix.
{ ... }: {
  homebrew.casks = [
    "aldente"
    "bartender"
    "blender"
    "crossover"
    "discord"
    "dropbox"
    "godot"
    "linear"
    "megasync"
    "moonlight"
    "obs"
    "obsidian"
    "plex"
    "plexamp"
    "proton-drive"
    "proton-mail"
    "proton-mail-bridge"
    "protonvpn"
    "rancher"
    "scrivener"
    "steam"
    #"transmission-remote-gui" # this is broken
    "vlc"
    "zen"
    "zoom"
  ];
}

{ pkgs, ... }:
let
  zsh = "${pkgs.zsh}/bin/zsh";
in
{
  programs.tmux = {
    enable = true;
    keyMode = "vi";
    plugins = with pkgs; [
      tmuxPlugins.better-mouse-mode
      tmuxPlugins.sensible
      tmuxPlugins.vim-tmux-navigator
    ];
    extraConfig = ''
      unbind C-b
      set -g prefix C-a
      bind-key u last-window
      bind-key e send-prefix
    
      set -g default-terminal "xterm-256color"
      # Make pam_tid.so work in tmux
      __helper="${pkgs.pam-reattach}/bin/reattach-to-session-namespace";
      set-option -g default-command "$__helper zsh"
      set -as terminal-overrides ',xterm*:Tc:sitm=\E[3m'
      set -sg terminal-overrides ",*:RGB"
    
      set -g history-limit 100000
      bind-key | split-window -h
      bind-key - split-window
    
      set -g renumber-windows on
      set-option -g mouse on
    
      set -g base-index 1
      setw -g pane-base-index 1
    
      setw -g aggressive-resize on
    
      set -sg escape-time 0
    
      bind h select-pane -L
      bind j select-pane -D
      bind k select-pane -U
      bind l select-pane -R
    
      bind C-j resize-pane -D 3
      bind C-k resize-pane -U 3
      bind C-l resize-pane -R 3
      bind C-h resize-pane -L 3
    
      bind '"' split-window -c "#{pane_current_path}"
      bind % split-window -h -c "#{pane_current_path}"
      bind c new-window -c "#{pane_current_path}"
    
      setw -g mode-keys vi
      bind-key -T copy-mode-vi 'v' send -X begin-selection
      # bind-key -T copy-mode-vi 'y' send -X copy-pipe-and-cancel "reattach-to-user-namespace pbcopy"
    
      set -g status-position bottom
      # ANSI colours only, so the bar follows kitty's light/dark theme.
      # colourNNN are fixed palette entries and do not change with the theme.
      set -g status-style bg=default,fg=default
      set -g status-left ""
      set -g status-right '#[fg=brightblack] %d/%m #[fg=default,bold] %H:%M:%S '
      set -g status-right-length 50
      set -g status-left-length 20
      setw -g mode-keys vi
      set -g set-clipboard on
      bind-key -T copy-mode-vi Enter send-keys -X copy-pipe-and-cancel pbcopy
      bind-key -T copy-mode-vi MouseDragEnd1Pane send-keys -X copy-pipe-and-cancel pbcopy
    
      setw -g window-status-current-format '#[fg=blue,bold] #I:#W#F '
      setw -g window-status-format '#[fg=brightblack] #I:#W#F '
    '';
  };
}

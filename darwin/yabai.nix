{ vars, config, ... }: 
 let
  colorScheme = config.home-manager.users.${vars.user}.colorScheme;
  activeColor = colorScheme.palette.base0B;
  normalColor = colorScheme.palette.base07;
in {
  services.yabai = {
    enable = true;
    enableScriptingAddition = true;
    config = {
      debug_output = "on";
      mouse_follows_focus = "off";
      focus_follows_mouse ="off";
      window_origin_display = "default";
      window_placement =" second_child";
      window_shadow = "on";
      window_animation_duration = 0.0;
      window_opacity_duration = 0.0;
      active_window_opacity = 1.0;
      normal_window_opacity = 0.90;
      window_opacity = "off";
      insert_feedback_color = "0xffd75f5f";
      active_window_border_color = "0xff${activeColor}";
      normal_window_border_color = "0x11${normalColor}";
      window_border_width = 4;
      window_border_radius = 12;
      window_border_blur = "off";
      window_border_hidpi = "on";
      window_border = "on";
      split_ratio = 0.50;
      split_type = "auto";
      auto_balance = "off";
      top_padding = 55;
      bottom_padding = 12;
      left_padding = 12;
      right_padding = 12;
      window_gap = 12;
      layout = "bsp";
      mouse_modifier = "fn";
      mouse_action1 = "move";
      mouse_action2 = "resize";
      mouse_drop_action = "swap";
    };
    extraConfig = ''
      yabai -m signal --add event=dock_did_restart action="sudo yabai --load-sa"
      sudo yabai --load-sa
      yabai -m config debug_output on
      yabai -m rule --add app="^(Steam Helper|steamwebhelper|wine64-preloader|Raycast|Neat|Terminal|Calculator|Calendar|Keka|Software Update|Dictionary|Karabiner-Elements|Karabiner-EventViewer)$" manage=off
      yabai -m rule --add app="^(VLC|System Settings|zoom.us|Photo Booth|Archive Utility|The Archive Browser|Activity Monitor|Bitwarden)$" manage=off
      yabai -m rule --add app="^Kitty$" space=2
      yabai -m rule --add app="^Anki$" space=2
      yabai -m rule --add app="^Telegram$" space=3
      yabai -m rule --add app="^Discord$" space=3
      yabai -m rule --add app="^Messages$" space=3 manage=off
      yabai -m rule --add app="^Spark$" space=3
      yabai -m rule --add app="^Spotify$" space=4
      yabai -m rule --add app="Outlook$" space=3
      yabai -m rule --add app="^Slack$" space=3
      yabai -m rule --add app="^Transmission" manage=off
      
      yabai -m rule --add app="^Finder$" sticky=on layer=above manage=off
      yabai -m rule --add app="^Logitech G HUB$" manage=off
      yabai -m rule --add app="^Logi Options$" manage=off
      yabai -m rule --add app="^Disk Utility$" sticky=on layer=above manage=off
      yabai -m rule --add app="^System Information$" sticky=on layer=above manage=off
      yabai -m rule --add title='Preferences$' manage=off
      yabai -m rule --add title='^Set Desktop Background$' manage=off
      yabai -m rule --add title='^Media$' manage=off
      yabai -m rule --add app="Fantastical" manage=off
      yabai -m rule --add app="^BlueBubbles$" manage=off
      yabai -m rule --add app="^DeepL$" manage=off
      yabai -m rule --add app="^Font Book$" manage=off
      yabai -m rule --add app="^Docker Desktop$" manage=off
      yabai -m rule --add app="^GarageSale$" manage=off
      
      yabai -m rule --add app="^IntelliJ IDEA$" manage=off
      yabai -m rule --add app="^IntelliJ IDEA$" title="( – )" manage=on space=1
      
      yabai -m signal --add event=window_created action='~/.config/yabai/bin/set-display-padding'
      yabai -m signal --add event=window_destroyed action='~/.config/yabai/bin/set-display-padding'
      yabai -m signal --add event=window_minimized action='~/.config/yabai/bin/set-display-padding'
      yabai -m signal --add event=window_deminimized action='~/.config/yabai/bin/set-display-padding'
      yabai -m signal --add event=space_changed action='~/.config/yabai/bin/set-display-padding'
      yabai -m signal --add event=application_visible action='~/.config/yabai/bin/set-display-padding'
      yabai -m signal --add event=application_hidden action='~/.config/yabai/bin/set-display-padding'
      
      ~/.config/yabai/bin/set-display-padding
      echo "yabai configuration loaded.."
      borders active_color=0xff${activeColor} inactive_color=0xff${normalColor} width=5.0 2>/dev/null 1>&2 &
    '';
  };
}

{ pkgs, ... }: {
  services.skhd = {
    enable = true;
    skhdConfig = 
      let
        yabai = "${pkgs.yabai}/bin/yabai";
        jq = "${pkgs.jq}/bin/jq";
      in 
      ''
        ## Navigation (lalt - ...)
        # Space Navigation (four spaces per display): lalt - {1, 2, 3, 4}
        lalt - 1 : export DISPLAY=$(${yabai} -m query --displays --display | ${jq} '.index'); ${yabai} -m space --focus (math 1+4\*\( $DISPLAY - 1 \))
        lalt - 2 : export DISPLAY=$(${yabai} -m query --displays --display | ${jq} '.index'); ${yabai} -m space --focus (math 2+4\*\( $DISPLAY - 1 \))
        lalt - 3 : export DISPLAY=$(${yabai} -m query --displays --display | ${jq} '.index'); ${yabai} -m space --focus (math 3+4\*\( $DISPLAY - 1 \))
        lalt - 4 : export DISPLAY=$(${yabai} -m query --displays --display | ${jq} '.index'); ${yabai} -m space --focus (math 4+4\*\( $DISPLAY - 1 \))
        
        # Window Navigation (through display borders): lalt - {h, j, k, l}
        lalt - h    : ${yabai} -m window --focus west  ; or ${yabai} -m display --focus west
        lalt - j    : ${yabai} -m window --focus south ; or ${yabai} -m display --focus south
        lalt - k    : ${yabai} -m window --focus north ; or ${yabai} -m display --focus north
        lalt - l    : ${yabai} -m window --focus east  ; or ${yabai} -m display --focus east
        
        # Extended Window Navigation: lalt - {o, y}
        lalt -    y : ${yabai} -m window --focus first
        lalt -    o : ${yabai} -m window --focus  last
        
        # Float / Unfloat window: lalt - space
        lalt - space : ${yabai} -m window --toggle float; ##sketchybar --trigger window_focus
        
        # Make window zoom to fullscreen: shift + lalt - f
        shift + lalt - f : ${yabai} -m window --toggle zoom-fullscreen; ##sketchybar --trigger window_focus
        
        # Make window zoom to parent node: lalt - f 
        lalt - f : ${yabai} -m window --toggle zoom-parent; ##sketchybar --trigger window_focus
        
        ## Window Movement (shift + lalt - ...)
        # Moving windows in spaces: shift + lalt - {h, j, k, l}
        shift + lalt - h : ${yabai} -m window --warp west; or ${yabai} -m window --warp last; or ${yabai} -m window --move rel:-10:0
        shift + lalt - j : ${yabai} -m window --warp south; or ${yabai} -m window --move rel:0:10
        shift + lalt - k : ${yabai} -m window --warp north; or ${yabai} -m window --move rel:0:-10
        shift + lalt - l : ${yabai} -m window --warp east; or ${yabai} -m window --warp first; or ${yabai} -m window --move rel:10:0
        
        # Toggle split orientation of the selected windows node: shift + lalt - s
        shift + lalt - t : ${yabai} -m window --toggle split
        
        # Moving windows between spaces: shift + lalt - {1, 2, 3, 4, p, n } (Assumes 4 Spaces Max per Display)
        shift + lalt - 1 : ${yabai} -m window --space 1; ${yabai} -m space --focus 1; #sketchybar --triger windows_on_spaces
        shift + lalt - 2 : ${yabai} -m window --space 2; ${yabai} -m space --focus 2; #sketchybar --triger windows_on_spaces
        shift + lalt - 3 : ${yabai} -m window --space 3; ${yabai} -m space --focus 3; #sketchybar --triger windows_on_spaces
        shift + lalt - 4 : ${yabai} -m window --space 4; ${yabai} -m space --focus 4; #sketchybar --triger windows_on_spaces
        
        ctrl + lalt - 1 : ${yabai} -m window --space 1; #sketchybar --triger windows_on_spaces
        ctrl + lalt - 2 : ${yabai} -m window --space 2; #sketchybar --triger windows_on_spaces
        ctrl + lalt - 3 : ${yabai} -m window --space 3; #sketchybar --triger windows_on_spaces
        ctrl + lalt - 4 : ${yabai} -m window --space 4; #sketchybar --triger windows_on_spaces
        #shift + lalt - 1 : set DISPLAY (${yabai} -m query --displays --display | ${jq} '.index');\
        #                  ${yabai} -m window --space (math 1+4\*\($DISPLAY - 1\));\
        #                  #sketchybar --trigger windows_on_spaces
        
        #shift + lalt - 2 : set DISPLAY (${yabai} -m query --displays --display | ${jq} '.index');\
        #                  ${yabai} -m window --space (math 2+4\*\($DISPLAY - 1\));\
        #                  #sketchybar --trigger windows_on_spaces
        #
        #shift + lalt - 3 : set DISPLAY (${yabai} -m query --displays --display | ${jq} '.index');\
        #                  ${yabai} -m window --space (math 3+4\*\($DISPLAY - 1\));\
        #                  #sketchybar --trigger windows_on_spaces
        #
        #shift + lalt - 4 : set DISPLAY (${yabai} -m query --displays --display | ${jq} '.index');\
        #                  ${yabai} -m window --space (math 4+4\*\($DISPLAY - 1\));\
        #                  #sketchybar --trigger windows_on_spaces
        
        shift + lalt - p : ${yabai} -m window --space prev; ${yabai} -m space --focus prev; #sketchybar --trigger windows_on_spaces
        shift + lalt - n : ${yabai} -m window --space next; ${yabai} -m space --focus next; #sketchybar --trigger windows_on_spaces
        
        # Mirror Space on X and Y Axis: shift + lalt - {x, y}
        shift + lalt - x : ${yabai} -m space --mirror x-axis
        shift + lalt - y : ${yabai} -m space --mirror y-axis
        
        ## Stacks (shift + ctrl - ...)
        # Add the active window to the window or stack to the {direction}: shift + ctrl - {j, k, l, ö}
        shift + ctrl - h    : ${yabai} -m window  west --stack (${yabai} -m query --windows --window | ${jq} -r '.id'); #sketchybar --trigger window_focus
        shift + ctrl - j    : ${yabai} -m window south --stack (${yabai} -m query --windows --window | ${jq} -r '.id'); #sketchybar --trigger window_focus
        shift + ctrl - k    : ${yabai} -m window north --stack (${yabai} -m query --windows --window | ${jq} -r '.id'); #sketchybar --trigger window_focus
        shift + ctrl - l    : ${yabai} -m window  east --stack (${yabai} -m query --windows --window | ${jq} -r '.id'); #sketchybar --trigger window_focus
        
        # Stack Navigation: shift + ctrl - {n, p}
        shift + ctrl - n : ${yabai} -m window --focus stack.next
        shift + ctrl - p : ${yabai} -m window --focus stack.prev
        
        ## Resize (ctrl + lalt - ...)
        # Resize windows: ctrl + lalt - {j, k, l, ö}
        #ctrl + lalt - h    : ${yabai} -m window --resize right:-100:0 ; or ${yabai} -m window --resize left:-100:0
        #ctrl + lalt - j    : ${yabai} -m window --resize bottom:0:100 ; or ${yabai} -m window --resize top:0:100
        #ctrl + lalt - k    : ${yabai} -m window --resize bottom:0:-100 ; or ${yabai} -m window --resize top:0:-100
        #ctrl + lalt - l    : ${yabai} -m window --resize right:100:0 ; or ${yabai} -m window --resize left:100:0
        
        # ## increase window size
        alt - a : ${yabai} -m window --resize left:-100:0
        alt - r : ${yabai} -m window --resize bottom:0:100
        alt - w : ${yabai} -m window --resize top:0:-100
        alt - s : ${yabai} -m window --resize right:100:0
        
        ctrl + alt - h : ${yabai} -m window --move left:-100:0
        ctrl + alt - j : ${yabai} -m window --move bottom:0:100
        ctrl + alt - k : ${yabai} -m window --move top:0:-100
        ctrl + alt - l : ${yabai} -m window --move right:100:0
        
        # ## decrease window size
        shift + alt - a : ${yabai} -m window --resize left:100:0
        shift + alt - r : ${yabai} -m window --resize bottom:0:-100
        shift + alt - w : ${yabai} -m window --resize top:0:100
        shift + alt - s : ${yabai} -m window --resize right:-100:0
        
        # Equalize size of windows: ctrl + lalt - e
        ctrl + lalt - e : ${yabai} -m space --balance
        
        # Enable / Disable gaps in current workspace: ctrl + lalt - g
        ctrl + lalt - g : ${yabai} -m space --toggle padding; ${yabai} -m space --toggle gap
        
        # Enable / Disable gaps in current workspace: ctrl + lalt - g
        ctrl + lalt - b : ${yabai} -m config window_border off 
        shift + ctrl + lalt - b : ${yabai} -m config window_border on
        
        ## Insertion (shift + ctrl + lalt - ...)
        # Set insertion point for focused container: shift + ctrl + lalt - {j, k, l, ö, s}
        shift + ctrl + lalt - h : ${yabai} -m window --insert west
        shift + ctrl + lalt - j : ${yabai} -m window --insert south
        shift + ctrl + lalt - k : ${yabai} -m window --insert north
        shift + ctrl + lalt - l : ${yabai} -m window --insert east
        shift + ctrl + lalt - s : ${yabai} -m window --insert stack
        
        ## Misc
        # Open new Alacritty window
        lalt - t : alacritty msg create-window
        
        # New window in hor./ vert. splits for all applications with ${yabai}
        #lalt - s : ${yabai} -m window --insert east;  skhd -k "cmd - n"
        #lalt - v : ${yabai} -m window --insert south; skhd -k "cmd - n"
        
        lalt - v : ${yabai} -m space --rotate 270
        
        # Toggle #sketchybar
        #shift + lalt - space : #sketchybar --bar hidden=toggle
        #shift + lalt - r : #sketchybar --exit
        
        # Volume controls
        lalt - u : m volume up
        lalt - d : m volume down
        lalt - p : spt pb -p
        lalt - n : spt pb -n
        lalt - backspace : spt pb -t
        #lalt - z : spt pb --like
      '';
  };
}

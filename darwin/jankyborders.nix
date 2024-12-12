{
  config,
  vars,
  ...
}:

let
  colorScheme = config.home-manager.users.${vars.user}.colorScheme;
  activeColor = colorScheme.palette.base0B;
  normalColor = colorScheme.palette.base07;
in
{
  services.jankyborders = {
    enable = true;
    width = 8.0;
    active_color = "0xff${activeColor}";
    inactive_color = "0xff${normalColor}"; 
  };
}

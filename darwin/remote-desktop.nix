{ vars, ... }:

{
  # Enable Apple Remote Desktop (Remote Management) for the primary user.
  # Note: since macOS 12.1, kickstart alone cannot grant full *control* on
  # non-MDM Macs; approve it once in System Settings > General > Sharing >
  # Remote Management if the client can only observe.
  system.activationScripts.extraActivation.text = ''
    echo "Enabling Apple Remote Desktop..."
    /System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart \
      -activate -configure -access -on \
      -users ${vars.user} -privs -all \
      -allowAccessFor -specifiedUsers \
      -restart -agent -menu >/dev/null 2>&1 || true
  '';
}

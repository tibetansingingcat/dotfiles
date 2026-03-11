{ pkgs, lib, vars, ... }:

{
  # Prevent Spotlight from indexing node_modules directories
  # This creates .metadata_never_index files in all node_modules directories
  # and sets up a periodic job to handle newly created ones

  # Run on system activation to mark existing node_modules
  system.activationScripts.extraActivation.text = ''
    echo "Excluding node_modules from Spotlight indexing..."
    find /Users/${vars.user} -type d -name "node_modules" -not -path "*/.*" 2>/dev/null | while read -r dir; do
      touch "$dir/.metadata_never_index" 2>/dev/null || true
    done
  '';

  # Set up a LaunchAgent to periodically check for new node_modules
  launchd.user.agents.spotlight-exclude-node-modules = {
    serviceConfig = {
      ProgramArguments = [
        "${pkgs.bash}/bin/bash"
        "-c"
        ''
          find /Users/${vars.user} -type d -name "node_modules" -not -path "*/.*" 2>/dev/null | while read -r dir; do
            if [ ! -f "$dir/.metadata_never_index" ]; then
              touch "$dir/.metadata_never_index" 2>/dev/null || true
            fi
          done
        ''
      ];
      StartInterval = 3600; # Run every hour
      RunAtLoad = true; # Run on login
      StandardErrorPath = "/tmp/spotlight-exclude-node-modules.err";
      StandardOutPath = "/tmp/spotlight-exclude-node-modules.out";
    };
  };
}

{ hermes-agent, ... }: {
  imports = [
    ../../home-manager
    ../../roles/personal/home.nix
    hermes-agent.homeManagerModules.default
  ];

  # CLI only. services.hermes-agent would take ownership of
  # ~/.hermes/config.yaml and make the CLI refuse config edits.
  programs.hermes-agent.enable = true;
}

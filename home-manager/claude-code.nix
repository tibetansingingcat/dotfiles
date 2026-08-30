# Claude Code: the CLI itself plus MCP servers, plugins and skills, all pinned
# via flake inputs.
#
# The package comes from sadjow/claude-code-nix rather than nixpkgs. nixpkgs
# 26.05 is stuck on 2.1.187, which predates Opus 5 entirely -- the binary
# contains no `claude-opus-5` strings at all -- so `model = "opus[1m]"` in
# settings.json cannot resolve there. That flake tracks upstream releases hourly
# and sets DISABLE_AUTOUPDATER=1, so it won't reinstate the native installer.
#
# Everything below is passed to the binary as --plugin-dir via the wrapper
# home-manager builds. That only works when whatever launches Claude Code
# resolves `claude` to the wrapper, which is now true everywhere: the native
# installer that used to shadow it at ~/.local/bin/claude is gone, and
# claudecode.nvim execs `claude` from PATH via vim.fn.termopen.
#
# Nothing here touches ~/.claude.json. Claude Code owns and continuously
# rewrites that file, and merging into it can only ever add keys -- deleting a
# server from this file would leave the old entry behind.
{ pkgs, claude-code-nix, serena, caveman, cellar, i-have-adhd, ... }:
let
  system = pkgs.stdenv.hostPlatform.system;

  # Installed on PATH as well as wired up as an MCP server below. Both must be
  # the same build: a separate `uv tool install serena-agent` was shadowing this
  # from ~/.local/bin at 1.5.3 while the MCP ran 1.6.2, and the newer one
  # migrated .serena/project.yml to a schema (`language_servers:`) that the older
  # one crashes on with KeyError: 'languages'.
  serenaPkg = serena.packages.${system}.default;

  # GitHub's *remote* MCP server (api.githubcopilot.com/mcp/ -- the hostname is
  # just where GitHub hosts it, nothing to do with Copilot-the-product) is
  # unusable from Claude Code: it only accepts pre-registered OAuth clients, and
  # Claude Code authenticates by dynamic client registration, hence
  # "Incompatible auth server: does not support dynamic client registration".
  #
  # So run GitHub's server locally over stdio instead, which skips OAuth. It
  # wants a token in the environment; rather than baking one into the world
  # readable nix store or adding a sops secret, borrow the one gh already holds
  # in the keychain. gh is referenced by store path, not PATH, because the
  # servers get spawned by whatever launched Claude Code.
  githubMcpServer = pkgs.writeShellScript "github-mcp-server-gh-auth" ''
    export GITHUB_PERSONAL_ACCESS_TOKEN="$(${pkgs.gh}/bin/gh auth token)"
    exec ${pkgs.github-mcp-server}/bin/github-mcp-server stdio "$@"
  '';

  mcpServersAttrs = {
    # Up-to-date library docs. Works unauthenticated; an API key
    # (https://context7.com) can be added later via a headers attr for
    # higher rate limits.
    context7 = {
      type = "http";
      url = "https://mcp.context7.com/mcp";
    };

    # PRs, issues, code search, notifications. Scopes come from whatever
    # `gh auth login` granted -- currently repo, read:org, gist.
    github = {
      type = "stdio";
      command = "${githubMcpServer}";
    };

    # Semantic code retrieval/editing via language servers.
    serena = {
      type = "stdio";
      command = "${serenaPkg}/bin/serena";
      args = [ "start-mcp-server" "--context" "ide-assistant" "--enable-web-dashboard" "false" ];
    };
  };

in
{
  programs.claude-code = {
    enable = true;

    package = claude-code-nix.packages.${system}.default;

    mcpServers = mcpServersAttrs;

    # ~/.claude/CLAUDE.md -- the only instructions loaded in every session
    # regardless of cwd, so this is where "always try Serena/cellar/Context7
    # before grepping or unzipping a jar" has to live. Nothing else nudges tool
    # choice: MCP servers and plugins being *installed* doesn't make them get
    # reached for, and a project CLAUDE.md only helps inside that project.
    #
    # This takes over a file rtk previously owned (`rtk init -g --auto-patch`
    # wrote `@RTK.md` into it), hence the `@RTK.md` on line 1 of the source
    # file -- dropping it would silently unload the rtk command reference.
    # RTK.md itself is still imperative and untouched. Consequence: CLAUDE.md is
    # now a read-only store symlink, so re-running `rtk init --auto-patch` can no
    # longer patch it; add future imports to claude-memory.md instead.
    context = ./dotfiles/claude-memory.md;

    plugins = [
      # Cellar's repo root is also a Claude Code plugin (skills/cellar), pinned
      # here to the same flake input as the CLI above rather than installed via
      # `/plugin marketplace add`. Unlike an MCP server a plugin has no
      # user-scope equivalent in ~/.claude.json, so this relies on the wrapper
      # being the `claude` that actually runs -- which it now is, since the
      # native installer at ~/.local/bin/claude is gone.
      cellar.outPath

      # Output shaping for an ADHD reader: /i-have-adhd turns it on, "stop adhd
      # mode" turns it off. The skill sets disable-model-invocation, so it only
      # ever runs when explicitly invoked.
      #
      # The plugin also registers a SessionStart hook that re-injects the
      # ruleset on every startup/resume/clear/compact, but only if
      # ~/.claude/.i-have-adhd-always exists. That flag is deliberately not
      # managed here: it's a runtime toggle, and creating it from nix would make
      # every session ADHD-mode with no way to opt out short of a rebuild.
      i-have-adhd.outPath
    ];

    skills = {
      # Terse output style to cut token usage. The repo also ships
      # caveman-commit, caveman-review, caveman-compress, etc.
      caveman = "${caveman}/skills/caveman";
    };
  };

  # rtk (Rust Token Killer) is deliberately NOT configured here. It's a
  # PreToolUse hook that rewrites Bash commands (`git status` -> `rtk git
  # status`) so the agent reads compressed output. Wiring it from nix would mean
  # setting programs.claude-code.settings, which turns ~/.claude/settings.json
  # into a read-only store symlink -- and Claude Code writes that file at
  # runtime (theme, voice, enabledPlugins, /config), same reason ~/.claude.json
  # is left alone above. So the hook was installed imperatively, once:
  #
  #   rtk init -g --auto-patch
  #
  # That adds hooks.PreToolUse -> `rtk hook claude` to ~/.claude/settings.json
  # (backup at settings.json.bak), writes ~/.claude/RTK.md, and points
  # ~/.claude/CLAUDE.md at it with `@RTK.md`. `rtk init --show` reports status;
  # `rtk init -g --uninstall` reverses it. The binary itself IS declarative --
  # brews in darwin/homebrew.nix -- so only the ~/.claude wiring is manual, and
  # it survives rebuilds precisely because nothing here manages it.
  home.packages = [
    # The cellar skill shells out to this binary, so it must be on PATH.
    cellar.packages.${system}.default
    # Same build as the MCP server above -- see the serenaPkg comment.
    serenaPkg
  ];
}

# Claude Code configuration: MCP servers and skills, all pinned via flake inputs.
{ pkgs, serena, caveman, ... }:
{
  programs.claude-code = {
    enable = true;

    mcpServers = {
      # Up-to-date library docs. Works unauthenticated; an API key
      # (https://context7.com) can be added later via a headers attr for
      # higher rate limits.
      context7 = {
        type = "http";
        url = "https://mcp.context7.com/mcp";
      };

      # GitHub's hosted MCP server (PRs, issues, code search, notifications).
      # No token in config: run /mcp inside Claude Code once to authenticate
      # via GitHub OAuth; Claude Code stores the credential itself.
      github = {
        type = "http";
        url = "https://api.githubcopilot.com/mcp/";
      };

      # Semantic code retrieval/editing via language servers.
      serena = {
        type = "stdio";
        command = "${serena.packages.${pkgs.stdenv.hostPlatform.system}.default}/bin/serena";
        args = [ "start-mcp-server" "--context" "ide-assistant" "--enable-web-dashboard" "false" ];
      };
    };

    skills = {
      # Terse output style to cut token usage. The repo also ships
      # caveman-commit, caveman-review, caveman-compress, etc.
      caveman = "${caveman}/skills/caveman";
    };
  };
}

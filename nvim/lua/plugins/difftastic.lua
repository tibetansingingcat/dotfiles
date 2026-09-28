-- Structural side-by-side diffs via difftastic, plus PR review (lua/pr_review.lua).
--   <leader>gR  pick a PR: checkout, difftastic view, PR buffer underneath,
--               inline review comments
--   <leader>gt  diff the current branch against origin/HEAD
--   <leader>gT  pick a commit to diff
-- In the diff panes:
--   K / gd            LSP hover / definition on the real file (right pane)
--   <localleader>ca   comment on line (visual: on range)
--   <localleader>cr   reply to thread on this line
--   <localleader>ct   toggle inline comments      <localleader>cR  reload them
--   <localleader>pc   comment on the PR
--   <localleader>vr   start review                <localleader>vs  submit review
-- Comment editors submit with <c-s>.
return {
  {
    "clabby/difftastic.nvim",
    dependencies = { "MunifTanjim/nui.nvim", "folke/snacks.nvim" },
    cmd = { "Difft", "DifftPick", "DifftPickRange", "DifftClose" },
    keys = {
      { "<leader>gR", function() require("pr_review").pick() end, desc = "Review PR (difftastic)" },
      { "<leader>gt", function() require("pr_review").branch() end, desc = "Difftastic PR (vs origin/HEAD)" },
      { "<leader>gT", "<cmd>DifftPick<cr>", desc = "Difftastic pick commit" },
    },
    opts = {
      download = true,
      vcs = "git",
      snacks_picker = { enabled = true },
    },
    config = function(_, opts)
      require("difftastic-nvim").setup(opts)
      require("pr_review").setup()
    end,
  },
}

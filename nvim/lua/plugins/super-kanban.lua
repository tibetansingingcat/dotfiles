-- Kanban boards in Obsidian-style markdown. :SuperKanban open [FILE], g? on the board for keys.
--   <leader>k  open <git root>/.kanban/<branch>.md, creating it if missing.
--              Slashes in the branch become folders. No branch: file picker.
return {
  {
    "hasansujon786/super-kanban.nvim",
    dependencies = { "folke/snacks.nvim" },
    cmd = "SuperKanban",
    keys = {
      {
        "<leader>k",
        function()
          local kanban = require("super-kanban")
          local root = vim.fs.root(0, ".git")
          local branch = root and vim.fn.systemlist({ "git", "-C", root, "branch", "--show-current" })[1]
          if not branch or branch == "" or vim.v.shell_error ~= 0 then
            return kanban.open(nil, true)
          end
          local path = root .. "/.kanban/" .. branch .. ".md"
          if vim.uv.fs_stat(path) then
            kanban.open(path)
          else
            vim.fn.mkdir(vim.fs.dirname(path), "p")
            kanban.create(path)
          end
        end,
        desc = "Kanban board for branch",
      },
    },
    opts = {},
  },
}

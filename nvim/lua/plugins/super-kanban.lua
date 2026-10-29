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
    -- AeroSpace takes alt-h/j/k/l for window focus, so the default <A-…> card moves never arrive.
    opts = {
      board = { width = 0.8, height = 0.8, border = "rounded" },
      mappings = {
        ["K"] = "move_up",
        ["J"] = "move_down",
        ["H"] = "move_left",
        ["L"] = "move_right",
      },
    },
    config = function(_, opts)
      require("super-kanban").setup(opts)
      -- The board hard-codes row = 0, col = 0. Clear them before it shows so snacks centres it.
      -- Lists are floats relative to the board, so they follow.
      local Board = require("super-kanban.ui.board")
      local setup_win = Board.setup_win
      function Board:setup_win(...)
        setup_win(self, ...)
        self.win.opts.row, self.win.opts.col = nil, nil
      end
    end,
  },
}

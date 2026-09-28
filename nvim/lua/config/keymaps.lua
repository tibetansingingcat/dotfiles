-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here
vim.keymap.set("n", "<leader>e", "<cmd>Neotree toggle<cr>", { desc = "Toggle Neo-tree" })

vim.keymap.set({ "n", "x" }, "<leader>rs", function()
  -- this keymap doesn't select any textobject by default, so you may need to provide one each time you use it.
  require("refactoring").select_refactor()
end, { desc = "Select refactor" })

-- LSP type hierarchy. gI (LazyVim) gives a flat list of implementers; these
-- give the nested tree, and the supertype direction that gI has no equivalent
-- for. Not mapped to gh/gH because those start Select mode in stock Vim.
vim.keymap.set("n", "<leader>ch", function()
  vim.lsp.buf.typehierarchy("subtypes")
end, { desc = "Subtypes (type hierarchy)" })

vim.keymap.set("n", "<leader>cH", function()
  vim.lsp.buf.typehierarchy("supertypes")
end, { desc = "Supertypes (type hierarchy)" })

-- Comment toggle via Neovim's built-in commenting (gc/gcc). remap = true so it
-- resolves to the native <Plug> mappings. Replaces Comment.nvim, which crashed
-- on filetypes without a treesitter parser (e.g. nix) on Neovim 0.11+.
-- Visual mode only: in normal mode <leader>/ stays LazyVim's grep, and gcc
-- already toggles the current line.
vim.keymap.set("x", "<leader>/", "gc", { remap = true, desc = "comment toggle" })

-- Explain the visual selection with `claude -p` and show the answer in a float.
-- In the difftastic view the buffer is a scratch pane, so name the diffed file.
vim.keymap.set("x", "<leader>ai", function()
  local lines = vim.fn.getregion(vim.fn.getpos("v"), vim.fn.getpos("."), { type = vim.fn.mode() })
  vim.api.nvim_feedkeys(vim.keycode("<Esc>"), "n", false)
  local ok, difft = pcall(require, "difftastic-nvim")
  local file = ok and difft.state.files[difft.state.current_file_idx]
  local where = file and vim.tbl_contains({ difft.state.left_win, difft.state.right_win }, vim.api.nvim_get_current_win())
      and ("%s (%s side of a PR diff)"):format(file.path, vim.api.nvim_get_current_win() == difft.state.left_win and "old" or "new")
    or vim.fn.expand("%:.")
  local prompt = ("Explain this %s code from %s. Be concise."):format(vim.bo.filetype, where)
  vim.notify("Asking Claude...", vim.log.levels.INFO, { title = "Claude" })
  vim.system({ "claude", "-p", prompt }, { stdin = table.concat(lines, "\n") }, function(res)
    vim.schedule(function()
      local text = res.code == 0 and res.stdout or res.stderr
      Snacks.win({
        text = vim.split(text, "\n"),
        ft = "markdown",
        width = 0.6,
        height = 0.6,
        border = "rounded",
        title = " Claude ",
        wo = { wrap = true, conceallevel = 2 },
      })
    end)
  end)
end, { desc = "Explain selection (Claude)" })

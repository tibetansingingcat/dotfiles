-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here
vim.keymap.set("n", "<leader>e", "<cmd>Neotree toggle<cr>", { desc = "Toggle Neo-tree" })

vim.keymap.set({ "n", "x" }, "<leader>rs", function()
  -- this keymap doesn't select any textobject by default, so you may need to provide one each time you use it.
  require("refactoring").select_refactor()
end, { desc = "Select refactor" })

-- Comment toggle via Neovim's built-in commenting (gc/gcc). remap = true so it
-- resolves to the native <Plug> mappings. Replaces Comment.nvim, which crashed
-- on filetypes without a treesitter parser (e.g. nix) on Neovim 0.11+.
vim.keymap.set("x", "<leader>/", "gc", { remap = true, desc = "comment toggle" })
vim.keymap.set("n", "<leader>/", "gcc", { remap = true, desc = "comment toggle" })

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

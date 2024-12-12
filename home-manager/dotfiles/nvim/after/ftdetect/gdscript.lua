vim.api.nvim_create_autocmd("BufWinEnter", {
  pattern = "*.gd",
  command = "set filetype=gdscript",
})

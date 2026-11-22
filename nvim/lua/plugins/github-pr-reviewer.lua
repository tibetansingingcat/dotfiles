-- PR review in the working tree: `:PR` opens the menu.
-- <leader>gv, not the README's <leader>p: the yanky extra owns <leader>p.
return {
  {
    "otavioschwanck/github-pr-reviewer.nvim",
    cmd = { "PR", "PRReviewMenu", "PRReview", "PRListReviewRequests", "PRLoadLastSession" },
    keys = {
      { "<leader>gv", "<cmd>PRReviewMenu<cr>", desc = "PR review menu" },
      { "<leader>gv", ":<C-u>'<,'>PRSuggestChange<CR>", mode = "v", desc = "PR suggest change" },
    },
    opts = { picker = "telescope" },
  },
}

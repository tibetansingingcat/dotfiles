-- Disable noice cmdline to fix crash on ':'
return {
  {
    "folke/noice.nvim",
    opts = {
      cmdline = { enabled = false },
    },
  },
}

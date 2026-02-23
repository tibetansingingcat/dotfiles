-- Disable noice cmdline and messages to fix crashes
return {
  {
    "folke/noice.nvim",
    opts = {
      cmdline = { enabled = false },
      messages = { enabled = false },
      popupmenu = { enabled = false },
    },
  },
}

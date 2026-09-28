-- LazyVim's octo extra sets default_to_projects_v2 = true, which makes every
-- PR/issue query request ProjectV2 timeline fields. Those need the
-- read:project scope, which neither the GHE nor github.com tokens have.
return {
  {
    "pwntester/octo.nvim",
    opts = { default_to_projects_v2 = false },
  },
}

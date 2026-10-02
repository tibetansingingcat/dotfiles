-- Follows kitty's current auto theme files, so the theme is chosen in one
-- place: programs.kitty.autoThemeFiles in kitty.nix. If an nvim colorscheme
-- has the kitty theme's name in lower case (Dayfox -> dayfox), it is used.
-- If not, a base16 scheme is built from kitty's colours.
-- Nvim re-sources this file when 'background' changes.
local function read_kitty_theme(mode)
  local auto = vim.fn.expand("~/.config/kitty/" .. mode .. "-theme.auto.conf")
  local c = {}
  local function parse(path)
    local ok, lines = pcall(vim.fn.readfile, path)
    if not ok then return end
    for _, line in ipairs(lines) do
      local inc = line:match("^include%s+(%S+)")
      if inc then
        c.name = inc:match("([^/]+)%.conf$")
        parse(inc)
      end
      local k, v = line:match("^(%S+)%s+(#%x%x%x%x%x%x)")
      if k then c[k] = v end
    end
  end
  parse(auto)
  return c
end

local c = read_kitty_theme(vim.o.background)
-- LazyVim applies the colorscheme before other plugins are on the rtp, so load
-- the plugin that provides the native scheme first.
if c.name then pcall(function() require("lazy.core.loader").colorscheme(c.name:lower()) end) end
-- Source the file directly: nvim ignores :colorscheme inside a colorscheme.
local native = c.name and vim.api.nvim_get_runtime_file("colors/" .. c.name:lower() .. ".{lua,vim}", false)[1]
if native then
  vim.cmd.source(native)
  vim.g.colors_name = "kitty"
  return
end
if not c.background then
  vim.cmd.colorscheme("habamax")
  return
end

-- ponytail: 16 ANSI colours mapped to base16 roles; a theme's own nvim port will look richer.
require("mini.base16").setup({
  palette = {
    base00 = c.background,
    base01 = c.color0,
    base02 = c.selection_background or c.color8,
    base03 = c.color8,
    base04 = c.color7,
    base05 = c.foreground,
    base06 = c.color15,
    base07 = c.color15,
    base08 = c.color1,
    base09 = c.color6,
    base0A = c.color3,
    base0B = c.color2,
    base0C = c.color6,
    base0D = c.color4,
    base0E = c.color5,
    base0F = c.color9,
  },
})
vim.g.colors_name = "kitty"

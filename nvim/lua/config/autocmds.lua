-- Autocmds are automatically loaded on the VeryLazy event
-- Default autocmds that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/autocmds.lua
-- Add any additional autocmds here
vim.api.nvim_create_autocmd({ "BufRead", "BufNewFile" }, {
  pattern = { "*/Source/*.cp", "*/Source/*.h" },
  callback = function()
    vim.opt.fileformats = { "unix", "dos", "mac" }
  end,
})
vim.api.nvim_create_autocmd({ "BufRead", "BufNewFile" }, {
  pattern = { "*.cp" },
  callback = function()
    vim.bo.filetype = "cpp"
  end,
})
-- Disable LazyVim format-on-save for Java; derive indentation from the
-- project's checkstyle.xml (tabs unless FileTabCharacter forbids them)
local checkstyle_cache = {}

local function checkstyle_settings(buf)
  local dir = vim.fs.dirname(vim.api.nvim_buf_get_name(buf))
  if not dir or dir == "" then
    return nil
  end
  local path = vim.fs.find("checkstyle.xml", { upward = true, path = dir })[1]
  if not path then
    -- Gradle/Maven convention: <repo>/config/checkstyle/checkstyle.xml
    local root = vim.fs.root(buf, { ".git", "settings.gradle", "pom.xml" })
    if root and vim.uv.fs_stat(root .. "/config/checkstyle/checkstyle.xml") then
      path = root .. "/config/checkstyle/checkstyle.xml"
    end
  end
  if not path then
    return nil
  end
  if checkstyle_cache[path] == nil then
    local ok, lines = pcall(vim.fn.readfile, path)
    local content = ok and table.concat(lines, "\n") or ""
    content = content:gsub("<!%-%-.-%-%->", "") -- ignore commented-out modules
    checkstyle_cache[path] = {
      spaces = content:find('name="FileTabCharacter"', 1, true) ~= nil,
      width = tonumber(content:match('name="basicOffset"%s+value="(%d+)"')) or 4,
    }
  end
  return checkstyle_cache[path]
end

-- Schema-aware SQL completion outside DBUI (e.g. migration files):
-- dadbod-completion reads b:db, so point it at the project's DATABASE_URL
-- (exported per-project via direnv). DBUI's own buffers already set b:db.
vim.api.nvim_create_autocmd("FileType", {
  pattern = { "sql", "mysql", "plsql" },
  callback = function(ev)
    if vim.b[ev.buf].db == nil and vim.env.DATABASE_URL then
      vim.b[ev.buf].db = vim.env.DATABASE_URL
    end
  end,
})

vim.api.nvim_create_autocmd("FileType", {
  pattern = { "java" },
  callback = function(ev)
    vim.b[ev.buf].autoformat = false
    -- editorconfig applies after FileType and would override these; for Java,
    -- checkstyle.xml is the source of truth instead
    vim.b[ev.buf].editorconfig = false
    local cs = checkstyle_settings(ev.buf) or { spaces = false, width = 4 }
    vim.bo[ev.buf].expandtab = cs.spaces
    vim.bo[ev.buf].tabstop = cs.width
    vim.bo[ev.buf].shiftwidth = cs.width
    vim.bo[ev.buf].softtabstop = cs.spaces and cs.width or 0
  end,
})

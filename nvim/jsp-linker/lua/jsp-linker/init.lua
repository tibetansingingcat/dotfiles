-- Runs the Letterboxd JSP-Java Linker (a VSCode extension, unmodified in server/out) as an LSP
-- server, and relays its Java questions to the jdtls client already attached in this Neovim.
--
-- Why a relay at all: the extension resolves every Java symbol through jdtls rather than parsing
-- Java itself. A standalone server has no way to reach the jdtls running under nvim-jdtls, and
-- starting a second one would mean a second full Eclipse workspace index of the same project.
--
-- Why notifications rather than a server-to-client request: Neovim answers a server-to-client
-- request from its handler's return value, synchronously. Doing a jdtls round trip there would
-- block the editor for the length of a workspace-symbol search -- and the extension issues these
-- eight at a time. So the server sends `jsp/java` as a *notification* carrying its own id, and we
-- reply with a `jsp/javaResult` notification once jdtls answers. Nothing blocks.

local M = {}

-- Parenthesised: gsub returns (string, count), and the count would otherwise land in normalize's
-- second argument, which expects an options table.
local root = vim.fs.normalize((debug.getinfo(1, "S").source:sub(2):gsub("/lua/jsp%-linker/init%.lua$", "")))
local server_main = root .. "/server/server.js"

M.config = {
  -- Filetype registration lives in the plugin spec (see lua/plugins/jsp-linker.lua).
  -- Mirrors the extension's own VSCode settings. Anything left unset keeps the extension's default.
  settings = {},
  root_markers = { "pom.xml", ".git" },
}

local function find_root(bufnr)
  local name = vim.api.nvim_buf_get_name(bufnr)
  local start = name ~= "" and vim.fs.dirname(name) or vim.uv.cwd()

  -- The webapp root is what the extension resolves `/`-rooted includes against, so prefer the
  -- outermost pom.xml of an unbroken reactor chain over the nearest module -- the same rule
  -- `:MvnClean` already uses in after/plugin/jdtls.lua.
  local pom = vim.fs.find("pom.xml", { upward = true, path = start })[1]
  if pom then
    local dir = vim.fs.dirname(pom)
    for parent in vim.fs.parents(dir) do
      if not vim.uv.fs_stat(parent .. "/pom.xml") then
        break
      end
      dir = parent
    end
    return dir
  end
  return vim.fs.root(bufnr, M.config.root_markers) or vim.uv.cwd()
end

local function jdtls_client()
  return vim.lsp.get_clients({ name = "jdtls" })[1]
end

--- Answers one relayed request, whatever the outcome. The server treats a `nil` result as
--- "abstain" -- exactly what its own gateway does when a jdtls call fails -- so a missing or busy
--- jdtls degrades to "cannot tell" rather than to a wrong answer.
local function reply(client, id, result)
  client:notify("jsp/javaResult", { id = id, result = result })
end

--- jdtls answers textDocument/* only for documents it has been told about. A JSP's Java target is
--- routinely a file no buffer has ever opened (and, for a decompiled library class, a `jdt://` URI
--- only nvim-jdtls can materialise), so load it first and let the usual FileType autocmds attach.
local function ensure_open(uri)
  if not uri then
    return
  end
  local bufnr = vim.uri_to_bufnr(uri)
  if not vim.api.nvim_buf_is_loaded(bufnr) then
    -- bufload triggers BufReadCmd, which is what nvim-jdtls registers for `jdt://`.
    pcall(vim.fn.bufload, bufnr)
  end
  -- Attach even when the buffer was already loaded: it may predate the jdtls client.
  local java = jdtls_client()
  if java and not vim.lsp.buf_is_attached(bufnr, java.id) then
    pcall(vim.lsp.buf_attach_client, bufnr, java.id)
  end
  return bufnr
end

local function make_handlers(get_client)
  return {
    ["jsp/java"] = function(_, params)
      local client = get_client()
      if not client then
        return
      end
      local java = jdtls_client()
      if not java then
        return reply(client, params.id, nil)
      end

      if params.open then
        ensure_open(params.open)
      end

      java:request(params.method, params.params, function(err, result)
        if err then
          reply(client, params.id, nil)
        else
          reply(client, params.id, result)
        end
      end)
    end,

    -- Reading a `jdt://` URI's decompiled source. Only nvim-jdtls can produce it, and it does so by
    -- populating a buffer, so go through one rather than asking jdtls directly.
    ["jsp/readUri"] = function(_, params)
      local client = get_client()
      if not client then
        return
      end
      local bufnr = ensure_open(params.uri)
      local ok, lines = pcall(vim.api.nvim_buf_get_lines, bufnr, 0, -1, false)
      reply(client, params.id, ok and table.concat(lines, "\n") or nil)
    end,

    -- The extension's "Open Generated Java" commands and its code lenses jump to a file.
    ["jsp/showDocument"] = function(_, params)
      vim.schedule(function()
        local bufnr = vim.uri_to_bufnr(params.uri)
        pcall(vim.fn.bufload, bufnr)
        vim.api.nvim_win_set_buf(0, bufnr)
        pcall(vim.api.nvim_win_set_cursor, 0, { (params.line or 0) + 1, params.character or 0 })
      end)
      local client = get_client()
      if client then
        reply(client, params.id, true)
      end
    end,
  }
end

local client_id_by_root = {}

function M.start(bufnr)
  bufnr = bufnr or vim.api.nvim_get_current_buf()

  -- server/node_modules is committed (pure JS, no native artifacts), so this should never fire --
  -- but a half-checked-out worktree would otherwise fail as an opaque "server exited".
  if not vim.uv.fs_stat(root .. "/server/node_modules/vscode-languageserver") then
    vim.notify(
      "jsp-linker: dependencies missing -- run `npm install` in " .. root .. "/server",
      vim.log.levels.ERROR
    )
    return
  end

  local project = find_root(bufnr)

  local existing = client_id_by_root[project]
  if existing and vim.lsp.get_client_by_id(existing) then
    vim.lsp.buf_attach_client(bufnr, existing)
    return existing
  end

  local self_id
  local id = vim.lsp.start({
    name = "jsp-linker",
    cmd = { "node", server_main, "--stdio" },
    root_dir = project,
    init_options = { settings = M.config.settings },
    settings = M.config.settings,
    handlers = make_handlers(function()
      return self_id and vim.lsp.get_client_by_id(self_id) or nil
    end),
    -- jdtls is usually attached well before the first JSP buffer is opened (any .java file starts
    -- it), in which case its LspAttach has already fired and will not fire again -- so the
    -- readiness signal has to be sent here too. Without it the extension's isReady() gate stays
    -- shut and it publishes no diagnostics at all, for the whole session.
    on_init = function(client)
      if jdtls_client() then
        client:notify("jsp/javaReady", vim.empty_dict())
      end
    end,
  }, { bufnr = bufnr })

  self_id = id
  client_id_by_root[project] = id
  return id
end

--- Tells the server that jdtls has finished its initial indexing. Until this fires, the extension
--- treats a "class not found" as "cannot tell yet" rather than as an error -- which is the whole
--- reason it has a readiness latch at all, and without this signal it would never leave that state.
local function announce_java_ready()
  for _, client in ipairs(vim.lsp.get_clients({ name = "jsp-linker" })) do
    client:notify("jsp/javaReady", vim.empty_dict())
  end
end

function M.setup(opts)
  M.config = vim.tbl_deep_extend("force", M.config, opts or {})

  local group = vim.api.nvim_create_augroup("JspLinker", { clear = true })

  -- *.jspf and *.tag reach filetype `jsp` via the plugin spec's own `init` (it has to run before
  -- any file is read; see lua/plugins/jsp-linker.lua). A *.tld is plain xml, and the extension
  -- validates those too -- but attaching to every xml buffer would be wrong, so match the name.
  vim.api.nvim_create_autocmd("FileType", {
    group = group,
    pattern = { "jsp", "xml" },
    callback = function(ev)
      if vim.bo[ev.buf].filetype == "xml" and not vim.api.nvim_buf_get_name(ev.buf):match("%.tld$") then
        return
      end
      M.start(ev.buf)
    end,
  })

  -- jdtls attaches long after the JSP server starts in a typical session (it indexes for a while,
  -- and `:JdtlsStart` can bring it back mid-session), so announce readiness on every attach rather
  -- than only at startup.
  vim.api.nvim_create_autocmd("LspAttach", {
    group = group,
    callback = function(ev)
      local client = vim.lsp.get_client_by_id(ev.data.client_id)
      if client and client.name == "jdtls" then
        vim.defer_fn(announce_java_ready, 500)
      end
    end,
  })

  vim.api.nvim_create_user_command("JspLinkerRestart", function()
    for _, client in ipairs(vim.lsp.get_clients({ name = "jsp-linker" })) do
      client:stop(true)
    end
    client_id_by_root = {}
    vim.defer_fn(function()
      for _, buf in ipairs(vim.api.nvim_list_bufs()) do
        if vim.api.nvim_buf_is_loaded(buf) and vim.bo[buf].filetype == "jsp" then
          M.start(buf)
        end
      end
    end, 300)
  end, { desc = "Restart the JSP linker server" })

  -- The extension's own commands, run server-side via workspace/executeCommand.
  local function command(name, id, desc)
    vim.api.nvim_create_user_command(name, function()
      local client = vim.lsp.get_clients({ name = "jsp-linker", bufnr = 0 })[1]
      if not client then
        return vim.notify("jsp-linker: not attached to this buffer", vim.log.levels.WARN)
      end
      client:request("workspace/executeCommand", {
        command = id,
        arguments = { vim.uri_from_bufnr(0) },
      }, function(err)
        if err then
          vim.notify("jsp-linker: " .. tostring(err.message or err), vim.log.levels.ERROR)
        end
      end)
    end, { desc = desc })
  end

  command("JspCheckAll", "vscode-jsp-linker.checkAllFiles", "Check every JSP and TLD in the workspace")
  command("JspRevalidate", "vscode-jsp-linker.revalidate", "Clear Java symbol caches and revalidate open files")
  command("JspOpenGeneratedJava", "vscode-jsp-linker.openGeneratedJava", "Open the Jasper-generated Java for this JSP")
  command("JspOpenGeneratedClass", "vscode-jsp-linker.openGeneratedClass", "Open the Jasper-generated class for this JSP")
end

return M

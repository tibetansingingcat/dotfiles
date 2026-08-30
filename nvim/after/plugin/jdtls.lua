-- Stop and resume jdtls on demand, so `mvn clean` can run without the language
-- server fighting it.
--
-- jdtls runs a full Eclipse workspace with auto-build enabled. During a
-- `mvn clean` it happily recompiles into target/ while maven is deleting it,
-- which wastes CPU at best and leaves a half-built workspace at worst. Without
-- a way to pause it the only recourse is quitting nvim for the duration.
--
-- Stopping the client alone isn't enough: LazyVim's java extra
-- (lazyvim.plugins.extras.lang.java) attaches jdtls from a `FileType java`
-- autocmd, so the next java buffer you touch brings it straight back. That
-- autocmd is registered without a group and its callback is a local, so there
-- is no handle to disable it. Instead we wrap jdtls.start_or_attach and make it
-- a no-op while suspended -- that intercepts every caller, LazyVim's autocmd
-- included, and means the server config still comes from the extra rather than
-- being duplicated here.

local suspended = false
local guarded = false

local function clients()
  return vim.lsp.get_clients({ name = "jdtls" })
end

-- Idempotent, and deliberately a no-op until nvim-jdtls is actually loaded:
-- requiring it here would force the ft-lazy plugin to load at startup.
local function install_guard()
  if guarded or not package.loaded["jdtls"] then
    return
  end
  local jdtls = require("jdtls")
  local start_or_attach = jdtls.start_or_attach
  jdtls.start_or_attach = function(...)
    if suspended then
      return
    end
    return start_or_attach(...)
  end
  guarded = true
end

-- nvim-jdtls loads on `ft = java`, so a stop issued before any java buffer
-- exists has nothing to wrap yet. Catch the plugin the moment lazy.nvim brings
-- it in, and the suspension still holds.
vim.api.nvim_create_autocmd("User", {
  pattern = "LazyLoad",
  callback = function(ev)
    if ev.data == "nvim-jdtls" then
      install_guard()
    end
  end,
})

local function stop()
  suspended = true
  install_guard()

  local running = clients()
  if #running == 0 then
    vim.notify("jdtls: not running; suspended, so it won't attach", vim.log.levels.INFO)
    return
  end

  for _, client in ipairs(running) do
    -- Escalate to a force-stop after 2s. A busy server can leave the graceful
    -- "shutdown" request unanswered -- which is precisely the situation here,
    -- since the reason for stopping it is that it's mid-build. Neovim's default
    -- is exit_timeout = false, i.e. wait forever, so pass the timeout
    -- explicitly.
    client:stop(2000)

    -- Clear the dying client's diagnostics. jdtls uses *push* diagnostics
    -- (textDocument/publishDiagnostics), and nvim only cleans up *pull*
    -- namespaces on LspDetach (`clear()` in vim/lsp/diagnostic.lua iterates
    -- client_pull_namespaces). So a stopped client's diagnostics stay in every
    -- buffer forever under nvim.lsp.jdtls.<id>, while the restarted server
    -- publishes under a new namespace -- each restart stacking another frozen
    -- snapshot, including warnings produced under settings since changed.
    vim.diagnostic.reset(vim.lsp.diagnostic.get_namespace(client.id))
  end

  vim.notify(("jdtls: stopping %d client(s)"):format(#running), vim.log.levels.INFO)
end

local function start()
  suspended = false

  if #clients() > 0 then
    vim.notify("jdtls: already running", vim.log.levels.INFO)
    return
  end

  -- Re-fire the java FileType autocmds in each loaded java buffer to let
  -- LazyVim's attach_jdtls build the config and start the server. The first
  -- buffer starts it; the rest attach to it, since start_or_attach reuses a
  -- server whose root_dir matches. nvim_buf_call is needed because
  -- attach_jdtls reads the *current* buffer's name to resolve the root.
  local attached = 0
  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_loaded(buf) and vim.bo[buf].filetype == "java" then
      vim.api.nvim_buf_call(buf, function()
        vim.api.nvim_exec_autocmds("FileType", { pattern = "java" })
      end)
      attached = attached + 1
    end
  end

  if attached == 0 then
    vim.notify("jdtls: resumed; will start on the next java buffer", vim.log.levels.INFO)
  else
    vim.notify(("jdtls: starting (%d java buffer(s))"):format(attached), vim.log.levels.INFO)
  end
end

-- Wait for the old process to actually exit before reattaching: start_or_attach
-- would otherwise find the still-dying client and reuse it. Polls rather than
-- guessing a delay, since shutdown time depends on what the server was doing.
local function when_stopped(fn, attempts)
  attempts = attempts or 24 -- ~6s, comfortably past the 2s force-stop above
  if #clients() == 0 or attempts <= 0 then
    fn()
  else
    vim.defer_fn(function()
      when_stopped(fn, attempts - 1)
    end, 250)
  end
end

local function restart()
  stop()
  when_stopped(start)
end

local function toggle()
  if #clients() > 0 then
    stop()
  else
    start()
  end
end

-- ---------------------------------------------------------------------------
-- :MvnClean -- run maven with jdtls out of the way, then bring it back.
--
-- Does the stop/build/start bracket in one step so there's nothing to remember
-- (and nothing to forget half way through a build). Runs async, so nvim stays
-- usable; jdtls comes back afterwards either way, including when the build
-- fails, because leaving the editor with no language server is never what you
-- wanted.

local building = false

-- The reactor root, not the nearest module. vim.fs.find stops at the first
-- pom.xml going up, which in a multi-module repo is the module you happen to
-- have open -- so `:MvnClean install` from a file in core/ would clean and
-- build core alone, silently doing a fraction of what you asked for.
--
-- Climbing only through an *unbroken* chain of pom.xml-bearing parents keeps
-- an unrelated pom further up the filesystem from hijacking the root, and
-- stops naturally at the first ancestor that isn't part of the reactor.
local function project_root()
  local dir = vim.fs.dirname(vim.api.nvim_buf_get_name(0))
  local pom = vim.fs.find("pom.xml", { upward = true, path = (dir ~= "" and dir) or vim.uv.cwd() })[1]
  if not pom then
    return nil
  end

  local root = vim.fs.dirname(pom)
  for parent in vim.fs.parents(root) do
    if not vim.uv.fs_stat(parent .. "/pom.xml") then
      break
    end
    root = parent
  end
  return root
end

local function show_output(lines)
  local buf = vim.api.nvim_create_buf(false, true)
  vim.bo[buf].bufhidden = "wipe"
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  -- Name is cosmetic and collides if a previous failure's window is still open.
  pcall(vim.api.nvim_buf_set_name, buf, "mvn output")
  vim.cmd("botright split")
  vim.api.nvim_win_set_buf(0, buf)
  vim.bo[buf].modifiable = false
end

-- Maven spells profile activation four ways; any of them means the caller has
-- an opinion and we should keep out of it.
local function has_profile_arg(args)
  for _, arg in ipairs(args) do
    if arg:match("^%-P") or arg:match("^%-%-activate%-profiles") then
      return true
    end
  end
  return false
end

local function mvn_clean(args)
  if building then
    vim.notify("mvn: a build is already running", vim.log.levels.WARN)
    return
  end

  local root = project_root()
  if not root then
    vim.notify("mvn: no pom.xml above this buffer", vim.log.levels.ERROR)
    return
  end

  -- Prefer the wrapper when the project ships one -- it pins the maven version
  -- the build expects, which is the whole reason it's committed.
  local mvnw = root .. "/mvnw"
  local cmd = vim.uv.fs_stat(mvnw) and { mvnw } or { "mvn" }
  table.insert(cmd, "clean")
  vim.list_extend(cmd, args)

  -- Default to -Pcli, which redirects <directory> to target/build-cli (see
  -- supermodel-parent). That keeps maven off target/, which is jdtls's own
  -- output folder -- so a clean no longer empties target/classes and leave the
  -- language server resolving nothing on restart. Explicit -P wins, since
  -- clearing target/ is occasionally exactly what you want.
  if not has_profile_arg(args) then
    table.insert(cmd, "-Pcli")
  end

  building = true
  stop()

  -- Only launch once the server is really gone; starting maven while jdtls is
  -- still writing to target/ is the race this command exists to avoid.
  when_stopped(function()
    vim.notify(("mvn: %s"):format(table.concat(cmd, " ")), vim.log.levels.INFO)
    vim.system(cmd, { cwd = root, text = true }, function(res)
      vim.schedule(function()
        building = false
        if res.code == 0 then
          vim.notify("mvn: done, restarting jdtls", vim.log.levels.INFO)
        else
          vim.notify(("mvn: failed (exit %d), restarting jdtls"):format(res.code), vim.log.levels.ERROR)
          show_output(vim.split((res.stdout or "") .. (res.stderr or ""), "\n", { trimempty = true }))
        end
        start()
      end)
    end)
  end)
end

-- stylua: ignore start
vim.api.nvim_create_user_command("JdtlsStop", stop, { desc = "Stop jdtls and keep it from reattaching" })
vim.api.nvim_create_user_command("JdtlsStart", start, { desc = "Resume jdtls and attach java buffers" })
vim.api.nvim_create_user_command("JdtlsRestart", restart, { desc = "Restart jdtls once it has exited" })
vim.api.nvim_create_user_command("JdtlsToggle", toggle, { desc = "Toggle jdtls" })
-- stylua: ignore end

-- Extra args are appended and -Pcli is added unless you name a profile, so
-- `:MvnClean install -DskipTests` runs `mvn clean install -DskipTests -Pcli`.
-- Pass a profile explicitly (`:MvnClean -P!cli`) to build into target/ instead.
vim.api.nvim_create_user_command("MvnClean", function(opts)
  mvn_clean(opts.fargs)
end, { nargs = "*", desc = "Stop jdtls, run mvn clean -Pcli, restart jdtls" })

vim.keymap.set("n", "<leader>cJ", toggle, { desc = "Toggle jdtls (stop for mvn clean)" })

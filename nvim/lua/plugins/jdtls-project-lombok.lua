-- Load the project's own Lombok as the jdtls javaagent, not Mason's.
--
-- LazyVim's java extra passes $MASON/share/jdtls/lombok.jar, and Mason downloads the *latest*
-- Lombok on every jdtls install. A Lombok newer than the project's can reject the project's
-- lombok.config (1.18.48 rejects letterboxd's `lombok.builder.className = Builder`). ECJ then
-- crashes while recording that error during annotation processing (NPE in
-- Compiler.backupAptProblems), the full build aborts, and whole modules end up with no classes.
--
-- m2e-apt writes the Maven-resolved Lombok into each module's .factorypath, so read it from there.
-- Falls back to Mason's jar when no .factorypath exists yet (first import of a project).
local function project_lombok(root)
  if not root then
    return nil
  end
  local factorypaths = vim.fn.glob(root .. "/.factorypath", false, true)
  vim.list_extend(factorypaths, vim.fn.glob(root .. "/*/.factorypath", false, true))
  for _, fp in ipairs(factorypaths) do
    for line in io.lines(fp) do
      local id = line:match('id="M2_REPO/(org/projectlombok/lombok/[^"]+%.jar)"')
      if id then
        local jar = vim.fn.expand("~/.m2/repository/") .. id
        if vim.fn.filereadable(jar) == 1 then
          return jar
        end
      end
    end
  end
end

return {
  {
    "mfussenegger/nvim-jdtls",
    opts = function(_, opts)
      local full_cmd = opts.full_cmd
      opts.full_cmd = function(o)
        local cmd = full_cmd(o)
        local jar = project_lombok(o.root_dir(vim.api.nvim_buf_get_name(0)))
        if jar then
          for i, arg in ipairs(cmd) do
            if arg:match("^%-%-jvm%-arg=%-javaagent:.*lombok.*%.jar$") then
              cmd[i] = "--jvm-arg=-javaagent:" .. jar
            end
          end
        end
        return cmd
      end
      return opts
    end,
  },
}

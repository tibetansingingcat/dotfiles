return {
  { import = "lazyvim.plugins.extras.lang.typescript" },
  { import = "lazyvim.plugins.extras.dap.core" },
  { import = "lazyvim.plugins.extras.coding.mini-surround" },
  -- add more treesitter parsers
  --
  {
    "okuuva/auto-save.nvim",
    event = { "InsertLeave", "TextChanged" },
    opts = { debounce_delay = 3000 },
  },
  {
    "elkowar/yuck.vim",
  },
  -- LSP keymaps
  {
    "neovim/nvim-lspconfig",
    init = function()
      local keys = require("lazyvim.plugins.lsp.keymaps").get()
      -- change a keymap
      keys[#keys + 1] =
        { "<a-cr>", vim.lsp.buf.code_action, desc = "Code Action", mode = { "n", "v" }, has = "codeAction" }

      local dap = require("dap")
      dap.adapters.godot = {
        type = "server",
        host = "127.0.0.1",
        port = 6006,
      }
      dap.configurations.gdscript = {
        {
          type = "godot",
          request = "launch",
          name = "Launch scene",
          project = "${workspaceFolder}",
        },
      }
    end,
  },
  {
    "nvim-telescope/telescope.nvim",
    keys = {
      -- disable the keymap to grep files
      -- { "<leader>fg", LazyVim.telescope("live_grep"), desc = "Grep (Root Dir)" },
    },
    dependencies = {
      { "nvim-telescope/telescope-live-grep-args.nvim" },
    },
    config = function()
      require("telescope").load_extension("live_grep_args")
    end,
  },
  {
    "nvim-treesitter/nvim-treesitter",
    opts = {
      ensure_installed = {
        "bash",
        "gdscript",
        "html",
        "java",
        "javascript",
        "json",
        "lua",
        "markdown",
        "markdown_inline",
        "python",
        "query",
        "regex",
        "scala",
        "tsx",
        "typescript",
        "vim",
        "yaml",
      },
    },
  },
  -- lualine component for metals
  {
    "nvim-lualine/lualine.nvim",
    event = "VeryLazy",
    opts = function(_, opts)
      table.insert(opts.sections.lualine_x, 2, {
        function()
          local status = vim.g["metals_status"]
          if status == nil then
            return ""
          end
          return status
        end,
        color = function()
          return require("lazyvim.util").ui.fg("DiagnosticWarn")
        end,
      })
    end,
  },
  -- nvim-metals
  {
    "scalameta/nvim-metals",
    ft = { "scala", "sbt" },
    lazy = false,
    dependencies = {
      "nvim-lua/plenary.nvim",
    },
    -- stylua: ignore
    keys = {
      { "<leader>cW", function () require('metals').hover_worksheet() end, desc = "Metals Worksheet" },
      { "<leader>cM", function () require('telescope').extensions.metals.commands() end, desc = "Telescope Metals Commands" },
    },
    init = function()
      local metals_config = require("metals").bare_config()

      metals_config.settings = {
        showImplicitArguments = true,
        showImplicitConversionsAndClasses = true,
        showInferredType = true,
        superMethodLensesEnabled = true,
        --serverVersion = "latest.snapshot",
        testUserInterface = "Test Explorer",
      }

      metals_config.init_options.statusBarProvider = "on"
      -- Debug settings if you're using nvim-dap
      local dap = require("dap")

      dap.configurations.scala = {
        {
          type = "scala",
          request = "launch",
          name = "RunOrTest",
          metals = {
            runType = "runOrTestFile",
            --args = { "firstArg", "secondArg", "thirdArg" }, -- here just as an example
            args = {},
            jvmOptions = { "--add-exports", "java.base/sun.nio.ch=ALL-UNNAMED" },
          },
        },
        {
          type = "scala",
          request = "launch",
          name = "Test Target",
          metals = {
            runType = "testTarget",
            args = {},
            jvmOptions = { "--add-exports", "java.base/sun.nio.ch=ALL-UNNAMED" },
          },
        },
      }
      metals_config.capabilities = require("cmp_nvim_lsp").default_capabilities()
      metals_config.on_attach = function(client, bufnr)
        require("metals").setup_dap()
      end

      local nvim_metals_group = vim.api.nvim_create_augroup("nvim-metals", { clear = true })
      vim.api.nvim_create_autocmd("FileType", {
        pattern = { "scala", "sbt" },
        callback = function()
          require("metals").initialize_or_attach(metals_config)
        end,
        group = nvim_metals_group,
      })
    end,
  },
  {
    "aaronhallaert/continuous-testing.nvim",
    lazy = false,
    config = function()
      require("continuous-testing").setup({
        notify = true, -- The default is false
        run_tests_on_setup = true, -- The default is true, run test on attach
        framework_setup = {
          ruby = {
            test_tool = "rspec",
            test_cmd = "bundle exec rspec %file",
          },
          javascript = {
            test_tool = "vitest", -- cwd of the executing test will be at package.json
            test_cmd = "yarn vitest run %file",
            root_pattern = "tsconfig.json", -- used to populate the root option of vitest
          },
          scala = {
            test_tool = "sbt",
            test_cmd = "sbt testOnly %file",
          },
        },
        project_override = {
          ["/Users/name/Developer/ruby-project"] = {
            ruby = {
              test_tool = "rspec",
              test_cmd = "docker exec -it name -- bundle exec rspec %file",
            },
          },
        },
      })
    end,
  },
  {
    "nvim-neotest/neotest",
    config = function()
      -- get neotest namespace (api call creates or returns namespace)
      local neotest_ns = vim.api.nvim_create_namespace("neotest")
      vim.diagnostic.config({
        virtual_text = {
          format = function(diagnostic)
            local message = diagnostic.message:gsub("\n", " "):gsub("\t", " "):gsub("%s+", " "):gsub("^%s+", "")
            return message
          end,
        },
      }, neotest_ns)
      require("neotest").setup({
        -- your neotest config here
        adapters = {
          require("neotest-go"),
          require("neotest-rust"),
          require("neotest-python"),
          require("neotest-scala")({
            runner = "sbt",
            framework = "scalatest",
          }),
        },
      })
    end,
    ft = { "go", "rust", "python" },
    dependencies = {
      "nvim-neotest/neotest-go",
      "nvim-neotest/neotest-python",
      "rouge8/neotest-rust",
      "aleixab/neotest-scala",
    },
    keys = {
      {
        "<leader>tt",
        function()
          require("neotest").run.run(vim.fn.expand("%"))
        end,
        desc = "Run File",
      },
      {
        "<leader>tT",
        function()
          require("neotest").run.run(vim.uv.cwd())
        end,
        desc = "Run All Test Files",
      },
      {
        "<leader>tr",
        function()
          require("neotest").run.run()
        end,
        desc = "Run Nearest",
      },
      {
        "<leader>tl",
        function()
          require("neotest").run.run_last()
        end,
        desc = "Run Last",
      },
      {
        "<leader>ts",
        function()
          require("neotest").summary.toggle()
        end,
        desc = "Toggle Summary",
      },
      {
        "<leader>to",
        function()
          require("neotest").output.open({ enter = true, auto_close = true })
        end,
        desc = "Show Output",
      },
      {
        "<leader>tO",
        function()
          require("neotest").output_panel.toggle()
        end,
        desc = "Toggle Output Panel",
      },
      {
        "<leader>tS",
        function()
          require("neotest").run.stop()
        end,
        desc = "Stop",
      },
    },
  },
  -- install without yarn or npm
  --{
  --  "iamcco/markdown-preview.nvim",
  --  cmd = { "MarkdownPreviewToggle", "MarkdownPreview", "MarkdownPreviewStop" },
  --  build = "cd app && yarn install",
  --  init = function()
  --    vim.g.mkdp_filetypes = { "markdown" }
  --  end,
  --  ft = { "markdown" },
  --},
  {
    "toppair/peek.nvim",
    event = { "VeryLazy" },
    build = "deno task --quiet build:fast",
    config = function()
      require("peek").setup()
      vim.api.nvim_create_user_command("PeekOpen", require("peek").open, {})
      vim.api.nvim_create_user_command("PeekClose", require("peek").close, {})
    end,
  },
  {
    "numToStr/Comment.nvim",
    opts = {
      -- add any options here
    },
    keys = {
      {
        "<leader>/",
        mode = { "v" },
        "<ESC><cmd>lua require('Comment.api').toggle.linewise(vim.fn.visualmode())<CR>",
        desc = "comment toggle",
      },
    },
    lazy = false,
  },
  {
    "vhyrro/luarocks.nvim",
    priority = 1000,
    config = true,
  },
  {
    "nvim-neorg/neorg",
    dependencies = { "luarocks.nvim" },
    lazy = false, -- Disable lazy loading as some `lazy.nvim` distributions set `lazy = true` by default
    version = "*", -- Pin Neorg to the latest stable release
    config = true,
  },
  --{
  --  "frankroeder/parrot.nvim",
  --  dependencies = { "fzf-lua", "plenary.nvim" },
  --  config = function()
  --    require("parrot").setup({
  --      providers = {
  --        pplx = {
  --          api_key = { "/usr/bin/security", "find-generic-password", "-s pplx-api-key", "-w" },
  --        },
  --        openai = {
  --          api_key = { "/usr/bin/security", "find-generic-password", "-s openai-api-key", "-w" },
  --        },
  --        anthropic = {
  --          api_key = { "/usr/bin/security", "find-generic-password", "-s anth-api-key", "-w" },
  --        },
  --      },
  --    })
  --  end,
  --},
  {
    "ibhagwan/fzf-lua",
    -- optional for icon support
    dependencies = { "nvim-tree/nvim-web-devicons" },
    config = function()
      -- calling `setup` is optional for customization
      require("fzf-lua").setup({})
    end,
  },
}

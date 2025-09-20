return {
  {
    "hrsh7th/nvim-cmp",
    dependencies = {
      "hrsh7th/cmp-nvim-lsp",
      "L3MON4D3/LuaSnip",
      "saadparwaiz1/cmp_luasnip",
    },
    config = function()
      local cmp = require("cmp")
      local luasnip = require("luasnip")

      cmp.setup({
        snippet = {
          expand = function(args)
            luasnip.lsp_expand(args.body)
          end,
        },
        mapping = cmp.mapping.preset.insert({
          ["<C-Space>"] = cmp.mapping.complete(),
          ["<CR>"] = cmp.mapping.confirm({ select = true }),
        }),
        sources = {
          { name = "nvim_lsp" },
          { name = "luasnip" },
        },
      })
    end,
  },
  {
    "nvim-neo-tree/neo-tree.nvim",
    branch = "v3.x",
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-tree/nvim-web-devicons", -- optional, for file icons
      "MunifTanjim/nui.nvim",
    },
    config = function()
      require("neo-tree").setup({
        close_if_last_window = true,
        popup_border_style = "rounded",
        enable_git_status = true,
        enable_diagnostics = true,
        filesystem = {
          follow_current_file = {
            enabled = true,
          },
          hijack_netrw_behavior = "open_default",
          filtered_items = {
            visible = true,
            hide_dotfiles = false,
            hide_gitignored = false,
          },
        },
        buffers = {
          follow_current_file = {
            enabled = true,
          },
        },
        window = {
          position = "left",
          width = 35,
          mappings = {
            ["<space>"] = "none", -- disable space to avoid conflicts
          },
        },
      })

      -- Optional: close Neo-tree if it's the last open window
      vim.api.nvim_create_autocmd("BufEnter", {
        pattern = "*",
        callback = function()
          if vim.fn.winnr("$") == 1 and vim.bo.filetype == "neo-tree" then
            vim.cmd("quit")
          end
        end,
      })
    end,
  },
  {
    "stevearc/oil.nvim",
    opts = {
      view_options = {
        show_hidden = true,
      },
      keymaps = {
        ["<C-s>"] = false, -- optional: disable split if you don’t use it
      },
    },
    dependencies = { "nvim-tree/nvim-web-devicons" },
    keys = {
      { "<leader>o", "<cmd>Oil<cr>", desc = "Open parent directory in Oil" },
      { "-", "<cmd>Oil<cr>", desc = "Open current directory in Oil (like netrw)" },
    },
  },
  {
    "folke/snacks.nvim",
    keys = {
      { "<leader>e", false },
      { "<leader>E", false },
    },
  },
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

      -- vim.lsp.enable("postgres_lsp")

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
    opts = {
      servers = {
        clangd = {
          cmd = { "clangd", "--fallback-style=none" },
          filetypes = { "c", "cpp" },
          single_file_support = true,
        },
      },
    },
    keys = {
      {
        "<leader>cb",
        function()
          local file = vim.fn.expand("%")
          if file == "" then
            print("No file open!")
          end

          local exe = vim.fn.expand("%:r")
          local cmd = { "clang++", "-std=c++98", "-Wall", "-o", exe, file }
          local result = vim.fn.system(cmd)
          if vim.v.shell_error ~= 0 then
            print("Compilation failed:\n" .. result)
            return
          end

          vim.cmd("botright split | terminal " .. exe)
        end,
        desc = "Compile and run C++98 file",
      },
    },
  },
  {
    "nvim-telescope/telescope.nvim",
    dependencies = {
      { "nvim-telescope/telescope-live-grep-args.nvim" },
    },
    config = function()
      local telescope = require("telescope")
      telescope.setup({
        defaults = {
          vimgrep_arguments = {
            "rg",
            "--color=never",
            "--no-heading",
            "--with-filename",
            "--line-number",
            "--column",
            "--smart-case",
            "--hidden",
            "--glob",
            "!.git/*",
          },
          file_ignore_patterns = {
            "node_modules",
            ".git'",
          }, -- 🚫 make sure you’re not ignoring dotfiles here
        },
        pickers = {
          find_files = {
            find_command = { "fd", "-HI", "--type", "f" },
          },
        },
      })
      telescope.load_extension("live_grep_args")
    end,
  },
  {
    "nvim-treesitter/nvim-treesitter",
    opts = {
      ensure_installed = {
        "bash",
        "c",
        "cpp",
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
        -- color = function()
        --   return require("lazyvim.util").ui.fg("DiagnosticWarn")
        -- end,
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
      {
        "mfussenegger/nvim-dap",
        config = function(self, opts)
          local dap = require("dap")
          dap.configurations.scala = {
            {
              type = "scala",
              request = "launch",
              name = "RunOrTest",
              metals = {
                runType = "runOrTestFile",
                jvmOptions = { "--add-exports", "java.base/sun.nio.ch=ALL-UNNAMED" },
                --args = { "firstArg", "secondArg", "thirdArg" }, -- here just as an example
              },
            },
            {
              type = "scala",
              request = "launch",
              name = "Test Target",
              metals = {
                runType = "testTarget",
                jvmOptions = { "--add-exports", "java.base/sun.nio.ch=ALL-UNNAMED" },
              },
            },
          }
        end,
      },
    },
    -- stylua: ignore
    keys = {
      { "<leader>cW", function () require('metals').hover_worksheet() end, desc = "Metals Worksheet" },
      { "<leader>cM", function () require('telescope').extensions.metals.commands() end, desc = "Telescope Metals Commands" },
    },
    init = function()
      local metals_config = require("metals").bare_config()

      local ok, cmp_nvim_lsp = pcall(require, "cmp_nvim_lsp")
      if ok then
        metals_config.capabilities = cmp_nvim_lsp.default_capabilities()
      end

      metals_config.settings = {
        showImplicitArguments = false,
        showImplicitConversionsAndClasses = false,
        showInferredType = true,
        superMethodLensesEnabled = true,
        --serverVersion = "latest.snapshot",
        testUserInterface = "Test Explorer",
      }

      metals_config.init_options.statusBarProvider = "on"

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
    "rcarriga/nvim-dap-ui",
    dependencies = { "nvim-neotest/nvim-nio" },
    keys = {
      {
        "<leader>du",
        function()
          require("dapui").toggle({})
        end,
        desc = "Dap UI",
      },
      {
        "<leader>de",
        function()
          require("dapui").eval()
        end,
        desc = "Eval",
        mode = { "n", "v" },
      },
    },
    opts = {},
    config = function(_, opts)
      local dap = require("dap")
      local dapui = require("dapui")
      dapui.setup(opts)
      dap.listeners.after.event_initialized["dapui_config"] = function()
        dapui.open({})
      end
      -- dap.listeners.before.event_terminated["dapui_config"] = function()
      -- dapui.close {}
      -- end
      -- dap.listeners.before.event_exited["dapui_config"] = function()
      -- dapui.close {}
      -- end
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
    dependencies = { "nvim-tree/nvim-web-devicons" },
    config = function()
      require("fzf-lua").setup({
        grep = {
          rg_opts = "--hidden --glob '!.git/*' --color=never --line-number --column --smart-case",
        },
        files = {
          fd_opts = "--hidden --exclude .git",
        },
      })
    end,
  },
}

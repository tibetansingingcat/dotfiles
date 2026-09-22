-- jdtls must report Lombok-generated accessors in its document-symbol outline, or the JSP linker's
-- bean checks misfire.
--
-- LazyVim's java extra already loads Lombok as a javaagent, so jdtls *compiles* @Data/@Getter
-- classes correctly. This setting is separate: it controls whether those generated members appear
-- in the symbol outline that `textDocument/documentSymbol` returns. The JSP linker reads that
-- outline to resolve `${x.y.z}` against getters and `<jsp:setProperty>` against setters, so with it
-- off, most beans in this codebase would flag as having no such property -- false errors, on
-- correct JSPs. See "Bean property validation" in nvim/jsp-linker/UPSTREAM-README.md.
return {
  {
    "mfussenegger/nvim-jdtls",
    opts = function(_, opts)
      opts.settings = vim.tbl_deep_extend("force", opts.settings or {}, {
        java = { symbols = { includeGeneratedCode = true } },
      })
      return opts
    end,
  },
}

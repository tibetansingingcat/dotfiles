-- The Letterboxd JSP-Java Linker, running as a local LSP server. See ../../jsp-linker/.
--
-- `dir` rather than a git URL: the plugin lives in this repo, next to the nvim config it belongs
-- to, because its `server/out` is a copy of a VSCode extension built elsewhere.
return {
  {
    "jsp-linker",
    dir = vim.fn.stdpath("config") .. "/jsp-linker",
    ft = { "jsp", "xml" },
    -- Neovim detects *.jsp on its own but not *.jspf or *.tag, and this has to run before any file
    -- is read -- registering it in `config` would be circular, since `config` only fires once `ft`
    -- has already matched, which for those two extensions it never would.
    init = function()
      vim.filetype.add({ extension = { jspf = "jsp", tag = "jsp" } })
    end,
    -- nvim-jdtls is not a hard dependency: the server starts without it and abstains on every
    -- Java question until jdtls attaches, which is the same state it is in while jdtls indexes.
    config = function()
      require("jsp-linker").setup({
        settings = {
          -- Supermodel's own tags, which declare scoped variables the JSP spec knows nothing
          -- about. Without these, every EL chain rooted in an sm:-declared variable is
          -- unresolvable. Attribute names below are read from the real
          -- META-INF/supermodel_rt.tld in supermodel-core 5.1.14 -- the version web/pom.xml's
          -- parent pins -- not guessed. Re-check them if that version moves.
          ["vscode-jsp-linker.elBindingTags"] = {
            {
              -- <sm:set var="x" name="bean" field="prop">, or value=, or a literal body.
              -- "object" is the implicit source when `field` is given with no `name`.
              tag = "sm:set",
              var = "var",
              source = "name",
              field = "field",
              value = "value",
              index = "index",
              defaultSource = "object",
              bodyType = "java.lang.String",
              -- sm:set's value setter takes String/Object, so a literal passes through
              -- unconverted rather than being coerced to a number.
              literalValueType = "java.lang.String",
            },
            {
              tag = "sm:forEach",
              var = "var",
              source = "name",
              field = "field",
              value = "items",
              iterates = true,
              defaultSource = "object",
              bareElAttributes = { "test" },
              -- `paginator` is a complete alternative to name+field="page".
              alternateSources = { { attribute = "paginator", field = "page" } },
              -- A Paginator's own base class implements Iterable<List<T>> (over pages, not
              -- items), so iterate getPage() first or `var` resolves to a whole page.
              iterationUnwrap = { { type = "com.cactuslab.pages.Paginator", field = "page" } },
              also = { { var = "varStatus", type = "jakarta.servlet.jsp.jstl.core.LoopTagStatus" } },
            },
            -- sm:url's var is always a built URL string, whatever it was called with.
            { tag = "sm:url", var = "var", type = "java.lang.String" },
            -- sm:ancestor walks the SBean graph for the nearest ancestor of a named class.
            { tag = "sm:ancestor", var = "var", classAttribute = "classCodes" },
            -- Declares nothing; registered only so its bare-EL `test` is syntax-checked.
            { tag = "sm:if", bareElAttributes = { "test" } },
            {
              tag = "sm:image",
              var = "var",
              source = "name",
              field = "field",
              index = "index",
              defaultSource = "object",
            },
          },
          -- target/build-cli is :MvnClean -Pcli's output -- a stale copy of the webapp that
          -- would otherwise be linted as if it were source.
          ["vscode-jsp-linker.exclude"] = {
            "**/target/**",
            "**/build-cli/**",
          },
          ["vscode-jsp-linker.compilerRecognizedElFunctions"] = {},
        },
      })
    end,
  },
}

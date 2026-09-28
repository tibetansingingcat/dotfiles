-- PR review on top of difftastic.nvim (diff view) and snacks.nvim's gh module
-- (PR buffer, comment editor, review API calls). See plugins/difftastic.lua for
-- the keymaps.
--
-- Hooks into difftastic.nvim internals (diff.render, the state table), so an
-- update to that plugin may break this.
local M = {}

local ns = vim.api.nvim_create_namespace("difft_pr_comments")
local pr ---@type {repo: string, number: string}? PR under review
local comments = {} -- review comments keyed by path
local at_row = {} -- row -> comments shown under it, for the current file
local show = true

local function difft()
  return require("difftastic-nvim")
end

local function notify(msg, level)
  vim.notify(msg, level or vim.log.levels.WARN, { title = "PR review" })
end

local function fetch_comments()
  comments = {}
  if not pr then
    return
  end
  local out = vim.fn.systemlist({
    "gh",
    "api",
    "--paginate",
    ("repos/%s/pulls/%s/comments"):format(pr.repo, pr.number),
    "--jq",
    ".[] | {id, in_reply_to_id, path, line, side, user: .user.login, body}",
  })
  if vim.v.shell_error ~= 0 then
    return notify(table.concat(out, "\n"))
  end
  for _, json in ipairs(out) do
    local c = vim.json.decode(json)
    -- ponytail: outdated comments (line == null) are skipped; see them in the PR buffer
    if type(c.line) == "number" then
      c.root = type(c.in_reply_to_id) == "number" and c.in_reply_to_id or c.id
      comments[c.path] = comments[c.path] or {}
      table.insert(comments[c.path], c)
    end
  end
  for _, list in pairs(comments) do
    table.sort(list, function(a, b)
      return a.root == b.root and a.id < b.id or a.root < b.root
    end)
  end
end

-- Add comments under their lines. The other pane gets as many blank virtual
-- lines so scrollbind alignment survives.
function M.render_comments(state, file)
  at_row = {}
  for _, buf in ipairs({ state.left_buf, state.right_buf }) do
    vim.api.nvim_buf_clear_namespace(buf, ns, 0, -1)
  end
  local list = file and comments[tostring(file.path)]
  if not (show and list) then
    return
  end
  local row_of = { LEFT = {}, RIGHT = {} }
  for row, pair in ipairs(file.aligned_lines or {}) do
    if type(pair[1]) == "number" then
      row_of.LEFT[pair[1] + 1] = row
    end
    if type(pair[2]) == "number" then
      row_of.RIGHT[pair[2] + 1] = row
    end
  end
  local lines_at = {} -- row -> virt_lines
  for _, c in ipairs(list) do
    local row = row_of[c.side] and row_of[c.side][c.line]
    if row then
      at_row[row] = at_row[row] or {}
      table.insert(at_row[row], c)
      lines_at[row] = lines_at[row] or {}
      local indent = c.root == c.id and "  " or "      "
      table.insert(lines_at[row], { { indent .. "󰅺 " .. c.user .. ":", "DiagnosticInfo" } })
      for _, l in ipairs(vim.split(c.body:gsub("\r", ""), "\n")) do
        table.insert(lines_at[row], { { indent .. "  " .. l, "Comment" } })
      end
    end
  end
  for row, virt in pairs(lines_at) do
    local blank = {}
    for i = 1, #virt do
      blank[i] = { { "" } }
    end
    vim.api.nvim_buf_set_extmark(state.right_buf, ns, row - 1, 0, { virt_lines = virt })
    vim.api.nvim_buf_set_extmark(state.left_buf, ns, row - 1, 0, { virt_lines = blank })
  end
end

local function rerender()
  local st = difft().state
  if st.right_buf then
    M.render_comments(st, st.files[st.current_file_idx])
  end
end

function M.refresh()
  fetch_comments()
  rerender()
end

function M.toggle()
  show = not show
  rerender()
end

-- Pick a PR (snacks picker), check it out and open the difftastic view with
-- the PR buffer underneath.
function M.pick()
  -- snacks passes `--repo owner/name` without a host, so gh assumes
  -- github.com. Point it at this repo's host (e.g. ghe.siriusxm.com).
  local url = vim.fn.system({ "git", "remote", "get-url", "origin" })
  vim.env.GH_HOST = url:match("^https?://([^/]+)/") or url:match("^[^@]+@([^:/]+)[:/]")
  Snacks.picker.gh_pr({
    confirm = function(picker, item)
      picker:close()
      M.open(item)
    end,
  })
end

---@param item {repo: string, number: number|string, uri: string}
function M.open(item)
  local n = tostring(item.number)
  local out = vim.fn.system({ "gh", "pr", "checkout", n })
  if vim.v.shell_error ~= 0 then
    return notify(out, vim.log.levels.ERROR)
  end
  local base = vim.trim(vim.fn.system({ "gh", "pr", "view", n, "--json", "baseRefName", "-q", ".baseRefName" }))
  vim.fn.system({ "git", "fetch", "origin", base })
  pr, jumps = { repo = item.repo, number = n }, {}
  fetch_comments()
  -- open() directly: the :Difft command defers it with vim.schedule
  difft().open("origin/" .. base .. "...HEAD")
  if difft().state.diff_tabpage then
    vim.cmd("botright 15split " .. vim.fn.fnameescape(item.uri))
    -- the split copies the diff pane's scrollbind; keep the description independent
    vim.wo.scrollbind, vim.wo.cursorbind = false, false
    vim.api.nvim_set_current_win(difft().state.right_win)
  end
end

-- Diff against origin/HEAD without a PR (no comments, review keys inactive).
function M.branch()
  pr, comments, jumps = nil, {}, {}
  vim.cmd("Difft origin/HEAD...HEAD")
end

---------------------------------------------------------------------------
-- Review actions. These build the same action tables as snacks' own
-- gh_diff_comment / gh_reply_to_comment and hand them to snacks, which opens
-- the body editor (<c-s> submits) and makes the API call.
---------------------------------------------------------------------------

local function actions()
  return require("snacks.gh.actions")
end

-- Fetch the full PR item (headRefOid, pendingReview, ...) and call cb with it.
local function with_item(cb)
  if not pr then
    return notify("No PR under review. Open one with <leader>gR")
  end
  require("snacks.gh.api").view(vim.schedule_wrap(cb), { type = "pr", repo = pr.repo, number = tonumber(pr.number) })
end

-- snacks has no after-submit hook; on_submit runs just before the request.
local function refresh_later(body)
  vim.defer_fn(M.refresh, 3000)
  return body
end

---@return table? file, string side, integer line  (line is 1-based in the file)
local function line_at(row)
  local st = difft().state
  local file = st.files[st.current_file_idx]
  local left = vim.api.nvim_get_current_win() == st.left_win
  local pair = file and file.aligned_lines and file.aligned_lines[row]
  local n = pair and pair[left and 1 or 2]
  if type(n) == "number" then
    return file, left and "LEFT" or "RIGHT", n + 1
  end
end

local THREAD_MUTATION = [[
  mutation($reviewId: ID!, $body: String!, $path: String!, $line: Int!, $side: DiffSide!, $startLine: Int, $startSide: DiffSide) {
    addPullRequestReviewThread(input: {
      pullRequestReviewId: $reviewId, body: $body, path: $path, line: $line,
      side: $side, startLine: $startLine, startSide: $startSide
    }) { thread { id } }
  }
]]

-- Comment on the cursor line, or on the selected lines in visual mode. Goes
-- into the pending review if one exists, else posts a single comment.
function M.comment()
  local from, to = vim.fn.line("v"), vim.fn.line(".")
  if from > to then
    from, to = to, from
  end
  vim.api.nvim_feedkeys(vim.keycode("<Esc>"), "nx", false)
  local file, side, line = line_at(to)
  local _, start_side, start = line_at(from)
  if not file then
    return notify("No line on this side here (filler line)")
  end
  if start_side ~= side or start == line then
    start = nil
  end
  with_item(function(item)
    local action = vim.deepcopy(actions().cli_actions.gh_comment)
    local s = side:sub(1, 1)
    action.title = ("Comment on %s %s"):format(file.path, start and (s .. start .. "-" .. s .. line) or (s .. line))
    action.on_submit = refresh_later
    if item.pendingReview then
      action.success = "Added to pending review on PR #{number}"
      action.api = {
        endpoint = "graphql",
        input = {
          query = THREAD_MUTATION,
          variables = {
            reviewId = item.pendingReview.id,
            path = tostring(file.path),
            side = side,
            line = line,
            startLine = start,
            startSide = start and side or nil,
          },
        },
      }
    else
      action.api = {
        endpoint = "/repos/{repo}/pulls/{number}/comments",
        input = {
          commit_id = item.headRefOid,
          path = tostring(file.path),
          side = side,
          line = line,
          start_line = start,
        },
      }
    end
    actions().run(item, action, {})
  end)
end

-- Reply to the thread under the cursor line (asks which one if several).
function M.reply()
  local list = at_row[vim.fn.line(".")]
  if not list then
    return notify("No comment thread on this line")
  end
  local roots, seen = {}, {}
  for _, c in ipairs(list) do
    if not seen[c.root] then
      seen[c.root] = true
      table.insert(roots, c)
    end
  end
  local function reply_to(c)
    if not c then
      return
    end
    with_item(function(item)
      local action = vim.deepcopy(actions().cli_actions.gh_comment)
      action.title = "Reply to " .. c.user
      action.on_submit = refresh_later
      action.api = { endpoint = "/repos/{repo}/pulls/{number}/comments", input = { in_reply_to = c.root } }
      actions().run(item, action, {})
    end)
  end
  if #roots == 1 then
    return reply_to(roots[1])
  end
  vim.ui.select(roots, {
    prompt = "Reply to thread",
    format_item = function(c)
      return c.user .. ": " .. vim.split(c.body, "\n")[1]
    end,
  }, reply_to)
end

-- PR-level comment (not tied to a line).
function M.pr_comment()
  with_item(function(item)
    actions().run(item, vim.deepcopy(actions().cli_actions.gh_comment), {})
  end)
end

function M.start_review()
  with_item(function(item)
    if item.pendingReview then
      return notify("A pending review already exists. Submit it with <localleader>vs")
    end
    actions().actions.gh_start_review.action(item, {})
  end)
end

function M.submit_review()
  with_item(function(item)
    if not item.pendingReview then
      return notify("No pending review. Start one with <localleader>vr")
    end
    actions().actions.gh_submit_review.action(item, {})
  end)
end

---------------------------------------------------------------------------
-- LSP. The diff panes are scratch buffers, so LSP has nothing to attach to.
-- Map the right (new) pane cursor to the real file and ask its client.
---------------------------------------------------------------------------

-- Calls cb(buf, params) for the cursor position in the real file, once an LSP
-- client is attached to it (the first request on a file may wait for startup).
local function with_real_pos(cb)
  local st = difft().state
  local file = st.files[st.current_file_idx]
  local row, col = unpack(vim.api.nvim_win_get_cursor(0))
  local pair = file and file.aligned_lines and file.aligned_lines[row]
  if not (pair and type(pair[2]) == "number") then
    return notify("No new-side line here")
  end
  local buf = vim.fn.bufadd(vim.fn.fnamemodify(tostring(file.path), ":p"))
  vim.fn.bufload(buf)
  vim.bo[buf].buflisted = true
  local function go()
    cb(
      buf,
      { textDocument = vim.lsp.util.make_text_document_params(buf), position = { line = pair[2], character = col } }
    )
  end
  if #vim.lsp.get_clients({ bufnr = buf }) > 0 then
    return go()
  end
  notify("Waiting for LSP on " .. tostring(file.path), vim.log.levels.INFO)
  vim.api.nvim_create_autocmd("LspAttach", { buffer = buf, once = true, callback = vim.schedule_wrap(go) })
end

function M.hover()
  with_real_pos(function(buf, params)
    vim.lsp.buf_request(buf, "textDocument/hover", params, function(_, result)
      if not (result and result.contents) then
        return notify("No hover info", vim.log.levels.INFO)
      end
      local md = vim.lsp.util.convert_input_to_markdown_lines(result.contents)
      vim.lsp.util.open_floating_preview(md, "markdown", { border = "rounded", focus_id = "difft_hover" })
    end)
  end)
end

local jumps = {} -- {file_idx, cursor} stack for <C-o> inside the diff view

-- Show file idx in the diff view with the cursor on new-side line `line` (0-based).
local function goto_diff(idx, line)
  local st = difft().state
  table.insert(jumps, { st.current_file_idx, vim.api.nvim_win_get_cursor(st.right_win) })
  difft().show_file(idx)
  for row, pair in ipairs(st.files[idx].aligned_lines or {}) do
    if pair[2] == line then
      vim.api.nvim_set_current_win(st.right_win)
      return vim.api.nvim_win_set_cursor(st.right_win, { row, 0 })
    end
  end
end

function M.jump_back()
  local j = table.remove(jumps)
  if not j then
    return notify("No earlier position", vim.log.levels.INFO)
  end
  local st = difft().state
  difft().show_file(j[1])
  vim.api.nvim_set_current_win(st.right_win)
  pcall(vim.api.nvim_win_set_cursor, st.right_win, j[2])
end

-- Real file in a float. It is a normal buffer, so LSP (and gd) work inside it.
local function peek(loc)
  local uri = loc.targetUri or loc.uri
  local range = loc.targetSelectionRange or loc.range
  local buf = vim.uri_to_bufnr(uri)
  vim.fn.bufload(buf)
  Snacks.win({
    buf = buf,
    width = 0.8,
    height = 0.8,
    border = "rounded",
    title = " " .. vim.fn.fnamemodify(vim.uri_to_fname(uri), ":~:.") .. " ",
    wo = { number = true, cursorline = true },
    keys = { q = "close" },
  })
  vim.api.nvim_win_set_cursor(0, { range.start.line + 1, range.start.character })
  vim.cmd("normal! zz")
end

-- Definition in a file of the review: jump there in the diff view (<C-o> back).
-- Anywhere else: peek at it in a float (q closes).
function M.definition()
  with_real_pos(function(buf, params)
    vim.lsp.buf_request(buf, "textDocument/definition", params, function(_, result)
      local loc = vim.islist(result) and result[1] or result
      if not loc then
        return notify("No definition found", vim.log.levels.INFO)
      end
      local fname = vim.uri_to_fname(loc.targetUri or loc.uri)
      local range = loc.targetSelectionRange or loc.range
      for idx, f in ipairs(difft().state.files) do
        if vim.fn.fnamemodify(tostring(f.path), ":p") == fname and f.status ~= "deleted" then
          return goto_diff(idx, range.start.line)
        end
      end
      peek(loc)
    end)
  end)
end

---------------------------------------------------------------------------

local pane_keys = {
  { "n", "K", M.hover, "LSP hover (real file)", right_only = true },
  { "n", "gd", M.definition, "Definition: in review or float", right_only = true },
  { "n", "<C-o>", M.jump_back, "Back to position before gd" },
  { { "n", "x" }, "<localleader>ca", M.comment, "PR: comment on line(s)" },
  { "n", "<localleader>cr", M.reply, "PR: reply to thread" },
  { "n", "<localleader>ct", M.toggle, "PR: toggle inline comments" },
  { "n", "<localleader>cR", M.refresh, "PR: reload comments" },
  { "n", "<localleader>pc", M.pr_comment, "PR: comment on PR" },
  { "n", "<localleader>vr", M.start_review, "PR: start review" },
  { "n", "<localleader>vs", M.submit_review, "PR: submit review" },
}

-- Wrap difftastic's render so every file shown gets comments and keymaps.
function M.setup()
  local diff = require("difftastic-nvim.diff")
  local render = diff.render
  diff.render = function(state, file)
    render(state, file)
    M.render_comments(state, file)
    for _, k in ipairs(pane_keys) do
      for _, buf in ipairs(k.right_only and { state.right_buf } or { state.left_buf, state.right_buf }) do
        vim.keymap.set(k[1], k[2], k[3], { buffer = buf, desc = k[4] })
      end
    end
  end
end

return M

---
name: tempo-timesheets
description: Fill in the user's Tempo timesheets on jira.savagebeast.com from git commits and Jira activity. Use when the user asks to "do my timesheets", "log my time", "fill in Tempo", or log hours for a date range.
---

# Tempo timesheets

Log the user's time in Tempo (Jira Data Center at `https://jira.savagebeast.com`).
Writing worklogs changes a timesheet that a manager approves. Follow the gates below.

## Facts (verified 2026-10-08)

- **Auth:** `Authorization: Bearer $JIRA_PERSONAL_TOKEN`. The variable is set in the shell. Never print it.
- **Worker key:** `JIRAUSER69401` (username `wrose`). Jira timezone: `America/Los_Angeles`.
- **Dates are US Pacific dates.** The laptop clock may be NZ time. "Today" is the US date. Do not log the current US day unless the user asks.
- **Do NOT use `jira_add_worklog` (MCP).** It cannot set Tempo attributes, and Tempo rejects or flags the entries. Use the Tempo REST API only.
- **Required work attributes:**
  - `_ActivityType_` (workAttributeId 1). Values are stored under a different name than the UI shows:
    | UI name | API `value` |
    |---|---|
    | Development Phase (default for dev work) | `Design` |
    | PTO | `Administrative` |
    | Testing - Pre Deployment | `Development` |
    | BAU, Maintenance, QOS | `Maintenance` |
    | Non-Project meeting | `Non-Projectmeeting` |
    The full list is at `GET /rest/tempo-core/1/work-attribute`.
  - `_Account_` (workAttributeId 35). Use the issue's own account from Jira field `customfield_23870` (`.key`).
- **TEMPO-925 = PTO** → activity `Administrative`.
- **8h per weekday** is the target.
- **Approved weeks are locked.** Edits fail with `"The timesheet status must be open for the period"`. Only the reviewer can reopen the week. Check the status with
  `GET /rest/tempo-timesheets/4/timesheet-approval/current?userKey=JIRAUSER69401&periodStartDate=YYYY-MM-DD`.

## API

```bash
B=https://jira.savagebeast.com/rest/tempo-timesheets/4/worklogs
H="Authorization: Bearer $JIRA_PERSONAL_TOKEN"

# List existing worklogs
curl -s -X POST -H "$H" -H "Content-Type: application/json" \
  -d '{"from":"2026-09-01","to":"2026-09-30","worker":["JIRAUSER69401"]}' $B/search

# Get the account for issues
curl -s -H "$H" "https://jira.savagebeast.com/rest/api/2/search?jql=key%20in%20(VORG-1,VORG-2)&fields=customfield_23870" \
  | jq -r '.issues[] | "\(.key) \(.fields.customfield_23870.key)"'

# Create (started = Pacific date, date only)
curl -s -X POST -H "$H" -H "Content-Type: application/json" -d '{
  "worker":"JIRAUSER69401","originTaskId":"VORG-1234","started":"2026-09-25",
  "timeSpentSeconds":28800,"billableSeconds":28800,"comment":"Short description",
  "attributes":{
    "_ActivityType_":{"name":"Activity Type","workAttributeId":1,"value":"Design"},
    "_Account_":{"name":"Account","workAttributeId":35,"value":"<customfield_23870 key>"}}}' $B

# Update: GET $B/<id>, then PUT $B/<id> with worker, originTaskId (.issue.key),
# started, timeSpentSeconds, billableSeconds, comment and attributes. This keeps the date, hours and comment.
```

A successful create returns an array. A failure returns `{"errors":...}`. Use `curl -w '%{http_code}'` and do not pipe straight into `jq`.

## Procedure

1. **Find the gaps.** List the existing Tempo worklogs for the range. Find the weekdays under 8h and the entries that have no `_ActivityType_`.
2. **Gather evidence.**
   - Commits: `for d in ~/sxm/codebase/*/; do git -C "$d" log --all --since=<start> --author="William Rose" --format="%ad ${d} %s" --date=short; done`
   - Jira: `assignee = currentUser() OR assignee was currentUser() AFTER <start>` with `updated >= <start>`. Branch names often contain the ticket key (`vorg-2384-...`).
   - Move weekend commits to the next weekday.
3. **Draft a table** (day, issue, hours, evidence). Mark guesses with ⚠. Ask about leave, holidays and meetings. **Wait for approval.**
4. **Create ONE test entry.** Read it back and ask the user to check it in the Tempo UI. **Wait for confirmation.**
5. **Create the rest.** Stop on the first failure.
6. **Verify.** Get the hours per day and the entries with no activity:
   ```bash
   ... $B/search | jq -r 'group_by(.started[:10])[] | "\(.[0].started[:10]) \((map(.timeSpentSeconds)|add)/3600)h missing=\(map(select(.attributes._ActivityType_==null))|length)"'
   ```
   Report the result to the user, including any failures.

## Do not

- Do not delete worklogs without asking.
- Do not try to reopen approved periods. Tell the user to ask the reviewer.
- Do not submit the timesheet for approval. The user does that.

# Offline Email Cheatsheet

## Neomutt Keybindings

### Navigation
| Key | Action |
|-----|--------|
| `j`/`k` | Move down/up |
| `Enter` | Open email |
| `i` | Return to inbox |
| `c` | Change folder |
| `q` | Quit/go back |
| `/` | Search current view |

### Email Actions
| Key | Action |
|-----|--------|
| `m` | Compose new email |
| `r` | Reply to sender |
| `g` | Group reply (reply all) |
| `L` | Reply to mailing list |
| `f` | Forward email |
| `d` | Delete (mark for deletion) |
| `u` | Undelete |
| `$` | Sync/commit changes |
| `s` | Save email to file |
| `p` | Print email |

### Custom Quick Searches
| Key | Action |
|-----|--------|
| `gi` | Go to inbox |
| `gu` | Go to unread |
| `gs` | Go to sent |
| `ga` | Go to archive |
| `\\` | Custom notmuch query |
| `X` | Custom notmuch query (alternative) |

### Sidebar
| Key | Action |
|-----|--------|
| `Ctrl+k` | Sidebar up |
| `Ctrl+j` | Sidebar down |
| `Ctrl+o` | Open sidebar folder |
| `Ctrl+p` | Previous folder with new mail |
| `Ctrl+n` | Next folder with new mail |
| `B` | Toggle sidebar |

### Utilities
| Key | Action |
|-----|--------|
| `Ctrl+u` | Extract URLs from email |
| `v` | View attachments |
| `?` | Show help |

## Notmuch Query Syntax

### Basic Searches
```
from:sender@example.com          # From specific sender
to:recipient@example.com         # To specific recipient
subject:"search term"            # In subject
body:"search term"               # In body
tag:inbox                        # With tag
date:today                       # From today
date:yesterday                   # From yesterday
date:7days..                     # Last 7 days
date:..30days                    # Older than 30 days
date:2024-01-01..2024-12-31     # Date range
```

### Logical Operators
```
term1 AND term2                  # Both terms
term1 OR term2                   # Either term
NOT term                         # Exclude term
from:alice OR from:bob          # Multiple senders
tag:inbox AND NOT tag:spam      # Inbox excluding spam
```

### Special Searches
```
thread:{ID}                      # Specific thread
folder:Sent                      # Specific folder
tag:attachment                   # Has attachments
is:unread                        # Unread (same as tag:unread)
*                                # All mail
```

### Example Queries
```
from:boss date:7days..                              # Boss's emails last week
subject:"urgent" AND tag:unread                     # Unread urgent emails
from:@company.com AND tag:attachment date:today     # Today's company emails with attachments
tag:inbox AND NOT (tag:spam OR tag:lists)          # Clean inbox view
```

## Common Tasks

### Daily Workflow
```bash
# Sync mail and update index (recommended)
mailsync

# Open email client
mail

# Or do it step by step
offlineimap      # Sync with Bridge
notmuch new      # Update search index
neomutt          # Open email client

# Refresh Bridge certificate if needed
refresh-bridge-cert
```

### Manual Operations
```bash
# Force full sync
offlineimap -o

# Sync specific account
offlineimap -a protonmail

# Update notmuch index
notmuch new

# Search from command line
notmuch search from:important@example.com

# Count total emails
notmuch count '*'

# Show email
notmuch show thread:{ID}
```

### Tagging Emails
```bash
# Add tag
notmuch tag +important -- from:boss@company.com

# Remove tag
notmuch tag -unread -- tag:unread AND date:..7days

# Multiple operations
notmuch tag +work +important -unread -- subject:"project alpha"

# Tag entire thread
notmuch tag +archived -- thread:{ID}
```

### Searching
```bash
# Interactive search
notmuch search from:alice@example.com

# Search and tag
notmuch search tag:inbox | grep "important" | xargs -I {} notmuch tag +important -- {}

# Show thread
notmuch show --format=json thread:{ID} | jq
```

## Maintenance

### Check Status
```bash
# View sync logs
tail -f ~/Library/Logs/offlineimap.log

# Check launchd service
launchctl list | grep offlineimap

# Notmuch database stats
notmuch count '*'
notmuch count tag:unread
```

### Rebuild Index
```bash
# Quick update
notmuch new

# Full rebuild
notmuch new --full-scan
```

### Service Control
```bash
# Stop auto-sync
launchctl unload ~/Library/LaunchAgents/org.nix-community.home.offlineimap.plist

# Start auto-sync
launchctl load ~/Library/LaunchAgents/org.nix-community.home.offlineimap.plist

# Restart service
launchctl unload ~/Library/LaunchAgents/org.nix-community.home.offlineimap.plist
launchctl load ~/Library/LaunchAgents/org.nix-community.home.offlineimap.plist
```

## Tips

1. **Search Everything**: Notmuch is blazing fast - use it liberally
2. **Tag Workflow**: Create custom tags for organization
3. **Compose in Vim**: Emails open in neovim automatically
4. **HTML Emails**: Converted to text automatically with lynx
5. **URLs**: Press `Ctrl+u` to extract and open URLs
6. **Attachments**: Press `v` to view attachment list
7. **Threading**: Neomutt groups by thread automatically
8. **Archive vs Delete**: Consider archiving instead of deleting

## Troubleshooting

### Sync Failed
- Check Bridge is running: `pgrep -f "Proton Mail Bridge"`
- Refresh certificate: `refresh-bridge-cert`
- Check password: `cat ~/.config/sops-nix/secrets/protonmail_bridge_password`
- Check certificate: `ls -l ~/.config/protonmail/bridge/cert.pem`
- View sync logs: `tail -f ~/Library/Logs/offlineimap.log`

### Notmuch Not Finding Emails
- Rebuild index: `notmuch new --full-scan`
- Check database: `notmuch count '*'`

### Neomutt Won't Start
- Check config: `neomutt -v`
- Check maildir exists: `ls ~/Mail/`
- Verify notmuch database: `ls ~/Mail/.notmuch/`

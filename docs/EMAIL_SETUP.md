# Protonmail Offline Email Setup

Complete setup for offline email with Protonmail Bridge, offlineimap, notmuch, and neomutt.

## Quick Start

### 1. Install Protonmail Bridge

```bash
brew install --cask protonmail-bridge
```

Open Bridge, log in to your Protonmail account, and ensure it's running.

### 2. Run the Setup Script

```bash
~/.dotfiles/scripts/setup-protonmail.sh
```

This script will:
- Check if Bridge is installed and running
- Extract/copy the Bridge certificate
- Open the secrets file for you to add your Bridge password

### 3. Add Bridge Password to Secrets

When the secrets file opens, add this line (after line 6, before the database section):

```yaml
protonmail_bridge_password: YOUR_BRIDGE_PASSWORD_HERE
```

**Important**: Use your Bridge mailbox password, NOT your Protonmail login password!
- Find it in Bridge → Settings → Account → Mailbox password

Save and close the file.

### 4. Update Email Address

Edit `~/.dotfiles/home-manager/email.nix` and replace all instances of:
- `YOUR_EMAIL@protonmail.com` with your actual Protonmail email address (3 places)

### 5. Rebuild Nix Configuration

```bash
cd ~/.dotfiles
darwin-rebuild switch --flake .
```

### 6. Initial Sync

```bash
# First sync (may take a while depending on mailbox size)
offlineimap

# Build notmuch index
notmuch new
```

### 7. Launch Neomutt

```bash
neomutt
```

## Daily Usage

### Shell Commands & Aliases

Convenient aliases added to your zsh:

```bash
# Sync email and update index
mailsync

# Open email client
mail

# Refresh Bridge certificate (if needed)
refresh-bridge-cert

# Search emails from command line
mailsearch from:boss@company.com

# Count total emails
mailcount '*'
```

### Neomutt Basics

- Press `?` in neomutt for help
- `q` to quit
- `j/k` to navigate (vim keys enabled)
- `Enter` to open email
- `m` to compose new email
- `r` to reply
- `d` to delete (marks for deletion)
- `$` to sync changes

### Quick Searches (in index view)

- `gi` - Go to inbox
- `gu` - Go to unread
- `gs` - Go to sent
- `ga` - Go to archive
- `\\` - Custom search query

### Sidebar Navigation

- `Ctrl+k` / `Ctrl+j` - Navigate sidebar
- `Ctrl+o` - Open selected folder
- `B` - Toggle sidebar

### URL Handling

- `Ctrl+u` - Extract and open URLs from current email

## Notmuch Search Queries

Notmuch is incredibly powerful. Here are some useful queries:

### Basic Searches

```bash
# Search by sender
notmuch search from:someone@example.com

# Search by subject
notmuch search subject:"important topic"

# Search by date
notmuch search date:today
notmuch search date:yesterday
notmuch search date:7days..
notmuch search date:2024-01-01..2024-12-31

# Search by attachment
notmuch search tag:attachment

# Unread emails
notmuch search tag:unread

# Search body content
notmuch search body:"search term"
```

### Advanced Searches

```bash
# Combine searches with AND
notmuch search from:boss@company.com AND date:7days..

# OR searches
notmuch search from:alice@example.com OR from:bob@example.com

# NOT searches
notmuch search tag:inbox AND NOT tag:lists

# Find emails with attachments from specific sender
notmuch search from:john@example.com AND tag:attachment

# Find large threads
notmuch search thread:{*}

# Search in specific folder
notmuch search folder:Archive AND from:important@example.com
```

### Custom Queries in Neomutt

In neomutt, press `\\` and enter any notmuch query, for example:
- `from:boss@company.com date:7days..`
- `subject:"quarterly report" date:2024-01-01..`
- `tag:unread AND tag:inbox`

## Maintenance

### Manual Sync

```bash
offlineimap
```

### Rebuild Index

```bash
notmuch new
```

### Check Sync Status

```bash
# Check launchd service status
launchctl list | grep offlineimap

# View sync logs
tail -f ~/Library/Logs/offlineimap.log
```

### Stop Automatic Sync

```bash
launchctl unload ~/Library/LaunchAgents/org.nix-community.home.offlineimap.plist
```

### Start Automatic Sync

```bash
launchctl load ~/Library/LaunchAgents/org.nix-community.home.offlineimap.plist
```

## Troubleshooting

### Certificate Issues

If you get SSL certificate errors:

```bash
# Refresh the certificate from running Bridge
refresh-bridge-cert

# Or manually
~/.dotfiles/scripts/refresh-bridge-cert.sh

# Verify certificate exists and is valid
ls -l ~/.config/protonmail/bridge/cert.pem
openssl x509 -in ~/.config/protonmail/bridge/cert.pem -noout -text
```

**Note**: Bridge v3 generates certificates dynamically. If you restart Bridge or it regenerates the certificate, offlineimap will automatically detect and refresh it. You can also manually refresh anytime with `refresh-bridge-cert`.

### Sync Issues

```bash
# Run offlineimap in debug mode
offlineimap -d imap

# Check Bridge is running
pgrep -x "Bridge"
```

### Notmuch Not Finding Emails

```bash
# Rebuild the entire index
notmuch new --full-scan

# Check database status
notmuch count '*'
```

### Neomutt Can't Connect

Check that:
1. Protonmail Bridge is running
2. You're using the Bridge mailbox password (not your login password)
3. Certificate file exists at `~/.config/protonmail/bridge/cert.pem`

## Configuration Locations

- Email config: `~/.dotfiles/home-manager/email.nix`
- Secrets: `~/.dotfiles/secrets/secrets.yaml`
- Maildir: `~/Mail/`
- Notmuch database: `~/Mail/.notmuch/`
- Neomutt cache: `~/.cache/neomutt/`
- Sync logs: `~/Library/Logs/offlineimap.log`

## Tips & Tricks

### Faster Searches

Notmuch is designed for speed. Even with tens of thousands of emails, searches are near-instant. Use it liberally!

### Tagging Workflow

Create custom tags for organizing emails:

```bash
# Tag an email thread
notmuch tag +important -- thread:0000000000000001

# Tag all emails from someone
notmuch tag +boss -- from:boss@company.com

# Remove tags
notmuch tag -unread -- tag:unread AND date:..7days
```

Then in neomutt, search by tag: `\\` → `tag:important`

### HTML Emails

HTML emails are automatically converted to text. If you need to view the HTML version:
1. Save the email: `s` in neomutt
2. Open with browser: `open ~/saved-email.eml`

### Composing with Templates

Create email templates in `~/Mail/templates/` and source them when composing.

### Multiple Accounts

To add more email accounts, add additional account blocks in `email.nix`. Each gets its own section in the notmuch database.

## Performance

With notmuch's full-text indexing:
- Searching 100,000+ emails: < 1 second
- Indexing new mail: seconds
- Storage overhead: ~10-20% of maildir size

This is exactly what you need to overcome Protonmail's slow web search!

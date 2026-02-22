#!/usr/bin/env bash
# Setup script for Protonmail offline email

set -e

echo "🔧 Protonmail Offline Email Setup"
echo "=================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Protonmail Bridge is installed
if [ ! -d "/Applications/Proton Mail Bridge.app" ]; then
    echo -e "${RED}❌ Protonmail Bridge is not installed${NC}"
    echo "Please install it from: https://proton.me/mail/bridge"
    echo "Or run: brew install --cask protonmail-bridge"
    exit 1
fi

echo -e "${GREEN}✓ Protonmail Bridge is installed${NC}"
echo ""

# Check if Bridge is running
if ! pgrep -f "Proton Mail Bridge" > /dev/null; then
    echo -e "${YELLOW}⚠ Protonmail Bridge is not running${NC}"
    echo "Starting Protonmail Bridge..."
    open "/Applications/Proton Mail Bridge.app"
    echo ""
    echo "Please log in to your Protonmail account in Bridge"
    read -p "Press Enter once you're logged in..."
fi

echo -e "${GREEN}✓ Protonmail Bridge is running${NC}"
echo ""

# Get Bridge certificate
BRIDGE_CONFIG_DIR="$HOME/.config/protonmail/bridge"
BRIDGE_CERT="$BRIDGE_CONFIG_DIR/cert.pem"

mkdir -p "$BRIDGE_CONFIG_DIR"

echo "📜 Extracting Protonmail Bridge certificate..."
echo "Bridge v3 generates its certificate dynamically, so we'll extract it from the running instance."
echo ""

# Extract certificate from running Bridge
if echo "Q" | openssl s_client -connect 127.0.0.1:1143 -starttls imap 2>/dev/null | openssl x509 -outform PEM > "$BRIDGE_CERT" 2>/dev/null; then
    if [ -s "$BRIDGE_CERT" ]; then
        echo -e "${GREEN}✓ Certificate extracted successfully${NC}"
        echo "Certificate details:"
        openssl x509 -in "$BRIDGE_CERT" -noout -subject -issuer -dates 2>/dev/null | sed 's/^/  /'
    else
        echo -e "${RED}❌ Failed to extract certificate (empty file)${NC}"
        echo "Make sure Bridge is running and logged in."
        exit 1
    fi
else
    echo -e "${RED}❌ Failed to extract certificate from Bridge${NC}"
    echo "Make sure:"
    echo "  1. Bridge is running"
    echo "  2. You're logged in to your Protonmail account"
    echo "  3. Bridge's IMAP server is listening on port 1143"
    exit 1
fi

echo ""
echo "📧 Now we need to add your Protonmail Bridge password to sops"
echo ""
echo "Your Bridge password is NOT your Protonmail password!"
echo "To find it:"
echo "  1. Open Protonmail Bridge"
echo "  2. Go to Settings > Account"
echo "  3. Click 'Mailbox password' to see/copy the password"
echo ""
echo "We'll now open the secrets file in your editor..."
read -p "Press Enter to continue..."

# Open secrets file with sops
cd "$HOME/.dotfiles"
sops secrets/secrets.yaml

echo ""
echo -e "${GREEN}✓ Secrets file updated${NC}"
echo ""
echo "📝 Final steps:"
echo ""
echo "1. Edit ~/.dotfiles/home-manager/email.nix and replace these placeholders:"
echo "   - YOUR_EMAIL@protonmail.com (appears 3 times)"
echo ""
echo "2. Rebuild your Nix configuration:"
echo "   darwin-rebuild switch --flake ~/.dotfiles"
echo ""
echo "3. Run initial email sync:"
echo "   offlineimap"
echo ""
echo "4. Build notmuch database:"
echo "   notmuch new"
echo ""
echo "5. Start using neomutt:"
echo "   neomutt"
echo ""
echo "6. The launchd agent will automatically sync every 5 minutes"
echo ""
echo -e "${GREEN}Setup complete! 🎉${NC}"

#!/usr/bin/env bash
# Refresh Protonmail Bridge certificate
# This extracts the certificate from the running Bridge instance

BRIDGE_CERT="$HOME/.config/protonmail/bridge/cert.pem"
BRIDGE_CERT_BACKUP="$HOME/.config/protonmail/bridge/cert.pem.bak"

# Check if Bridge is running
if ! pgrep -f "Proton Mail Bridge" > /dev/null; then
    echo "Warning: Protonmail Bridge is not running" >&2
    exit 1
fi

# Create backup of existing certificate if it exists
if [ -f "$BRIDGE_CERT" ]; then
    cp "$BRIDGE_CERT" "$BRIDGE_CERT_BACKUP" 2>/dev/null
fi

# Create directory if it doesn't exist
mkdir -p "$(dirname "$BRIDGE_CERT")"

# Extract certificate from running Bridge
if echo "Q" | openssl s_client -connect 127.0.0.1:1143 -starttls imap 2>/dev/null | openssl x509 -outform PEM > "$BRIDGE_CERT.tmp" 2>/dev/null; then
    if [ -s "$BRIDGE_CERT.tmp" ]; then
        mv "$BRIDGE_CERT.tmp" "$BRIDGE_CERT"

        # Only output if running interactively (not silently)
        if [ -t 1 ]; then
            echo "✓ Bridge certificate refreshed successfully"
            openssl x509 -in "$BRIDGE_CERT" -noout -subject -dates 2>/dev/null
        fi
        exit 0
    else
        rm -f "$BRIDGE_CERT.tmp"
        echo "Error: Failed to extract certificate (empty response)" >&2
        # Restore backup if extraction failed
        if [ -f "$BRIDGE_CERT_BACKUP" ]; then
            mv "$BRIDGE_CERT_BACKUP" "$BRIDGE_CERT"
        fi
        exit 1
    fi
else
    rm -f "$BRIDGE_CERT.tmp"
    echo "Error: Failed to connect to Bridge IMAP server" >&2
    # Restore backup if extraction failed
    if [ -f "$BRIDGE_CERT_BACKUP" ]; then
        mv "$BRIDGE_CERT_BACKUP" "$BRIDGE_CERT"
    fi
    exit 1
fi

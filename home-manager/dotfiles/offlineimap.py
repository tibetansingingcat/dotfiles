#!/usr/bin/env python3
"""
Helper functions for offlineimap with Protonmail Bridge
"""

import os
import ssl
import subprocess


def get_password(account=None):
    """
    Get password from sops-encrypted secrets file.
    This is called by offlineimap when it needs the password.
    """
    # Default to protonmail for backwards compatibility
    if account is None or account == "protonmail":
        secrets_path = os.path.expanduser("~/.config/sops-nix/secrets/protonmail_bridge_password")
    elif account == "fastmail":
        secrets_path = os.path.expanduser("~/.config/sops-nix/secrets/fastmail_app_password")
    else:
        print(f"Unknown account: {account}")
        return ""

    try:
        with open(secrets_path, 'r') as f:
            return f.read().strip()
    except Exception as e:
        print(f"Error reading password for {account}: {e}")
        return ""


# Account-specific password functions for offlineimap
def get_pass_protonmail():
    """Get Protonmail Bridge password"""
    return get_password("protonmail")


def get_pass_fastmail():
    """Get Fastmail app password"""
    return get_password("fastmail")


# Alias for backwards compatibility
def get_pass():
    """Alias for get_password() - used by offlineimap"""
    return get_password("protonmail")


def cert_fingerprint(pemfile):
    """
    Calculate SSL certificate fingerprint.
    Used for certificate pinning with Protonmail Bridge.
    """
    import hashlib
    with open(pemfile, 'rb') as f:
        cert_data = f.read()
    return hashlib.sha256(cert_data).hexdigest()


def check_and_refresh_certificate():
    """
    Check if certificate needs refreshing and update it if necessary.
    Returns True if certificate is valid, False otherwise.
    """
    cert_path = os.path.expanduser("~/.config/protonmail/bridge/cert.pem")
    refresh_script = os.path.expanduser("~/.dotfiles/scripts/refresh-bridge-cert.sh")

    # If certificate doesn't exist, try to create it
    if not os.path.exists(cert_path):
        # Only print if running interactively
        if os.isatty(1):
            print("Certificate not found, extracting from Bridge...")
        if os.path.exists(refresh_script):
            try:
                subprocess.run([refresh_script], check=True, capture_output=True)
                return True
            except subprocess.CalledProcessError:
                if os.isatty(1):
                    print(f"Failed to extract certificate. Run: {refresh_script}")
                return False
        return False

    # Check if certificate file is readable and has content
    try:
        with open(cert_path, 'r') as f:
            content = f.read()
            if len(content) < 100 or 'BEGIN CERTIFICATE' not in content:
                # Certificate looks invalid, try refreshing
                if os.path.exists(refresh_script):
                    subprocess.run([refresh_script], check=True, capture_output=True)
                return True
    except Exception:
        # If we can't read it, try refreshing
        if os.path.exists(refresh_script):
            try:
                subprocess.run([refresh_script], check=True, capture_output=True)
                return True
            except subprocess.CalledProcessError:
                return False
        return False

    return True


def customize_tls():
    """
    Customize TLS settings for Protonmail Bridge.
    Bridge uses self-signed certificates, so we need to handle that.
    Automatically checks and refreshes certificate if needed.
    """
    # Check and refresh certificate if necessary
    check_and_refresh_certificate()

    # Get the certificate path
    cert_path = os.path.expanduser("~/.config/protonmail/bridge/cert.pem")

    if not os.path.exists(cert_path):
        print(f"Error: Certificate not found at {cert_path}")
        print("Run: ~/.dotfiles/scripts/refresh-bridge-cert.sh")
        return None

    # Create SSL context with custom certificate
    context = ssl.create_default_context(cafile=cert_path)
    # Don't check hostname since Bridge uses localhost
    context.check_hostname = False
    # But do verify the certificate
    context.verify_mode = ssl.CERT_REQUIRED

    return context

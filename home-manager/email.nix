{ config, pkgs, lib, ... }:
let
  # Email storage location
  maildir = "${config.home.homeDirectory}/Mail";

in
{
  # Install email-related packages
  home.packages = with pkgs; [
    offlineimap
    notmuch
    neomutt
    lynx # For viewing HTML emails in terminal
    w3m # Alternative HTML viewer
    urlscan # For extracting URLs from emails
  ];

  # Email account configuration
  accounts.email = {
    maildirBasePath = maildir;

    accounts.fastmail = {
      primary = false;
      address = "will@williamro.se";
      realName = "William Rose";
      userName = "wrose@fastmail.com";

      # Fastmail IMAP configuration (read-only archive)
      imap = {
        host = "imap.fastmail.com";
        port = 993;
        tls.enable = true;
      };

      # Get password from sops
      passwordCommand = "cat ${config.sops.secrets.fastmail_app_password.path}";

      # Enable offlineimap for this account
      offlineimap = {
        enable = true;
        extraConfig = {
          remote = {
            # Sync all folders and all time (complete archive)
            folderfilter = "lambda foldername: foldername not in ['All Mail', 'Notes']";
            # Password from Python function
            remotepasseval = "get_pass_fastmail()";
          };
          local = {
            # Local maildir settings
            sync_deletes = "yes";
          };
          account = {
            # Sync interval (in minutes) when running in daemon mode
            autorefresh = 10;
            quick = 10;
            # Number of parallel connections
            maxconnections = 20;
          };
        };
      };

      # Enable notmuch for indexing and searching
      notmuch.enable = true;

      # Don't enable neomutt - this is a read-only archive account
      neomutt.enable = false;
    };

    accounts.protonmail = {
      primary = true;
      address = "will@williamro.se";
      realName = "William Rose";
      userName = "will@williamro.se";

      # Protonmail Bridge configuration
      imap = {
        host = "127.0.0.1";
        port = 1143;
        tls.enable = false; # We handle TLS manually in offlineimap extraConfig
      };

      smtp = {
        host = "127.0.0.1";
        port = 1025;
        tls.enable = false; # We handle TLS manually in neomutt extraConfig
      };

      # Get password from sops
      passwordCommand = "cat ${config.sops.secrets.protonmail_bridge_password.path}";

      # Enable offlineimap for this account
      offlineimap = {
        enable = true;
        extraConfig = {
          remote = {
            # Exclude "All Mail" (redundant) and only sync important folders
            folderfilter = "lambda foldername: foldername not in ['All Mail']";
            # Password from Python function
            remotepasseval = "get_pass_protonmail()";
            # Use STARTTLS (not direct SSL)
            ssl = "no";
            starttls = "yes";
            # SSL version
            ssl_version = "tls1_2";
            # Certificate file for Bridge's self-signed cert
            sslcacertfile = "${config.home.homeDirectory}/.config/protonmail/bridge/cert.pem";
          };
          local = {
            # Local maildir settings
            sync_deletes = "yes";
          };
          account = {
            # Sync only emails from the last 365 days
            maxage = 365;
            # Sync interval (in minutes) when running in daemon mode
            autorefresh = 5;
            quick = 10;
            # Number of parallel connections (aggressive for local Bridge)
            maxconnections = 20;
          };
        };
      };

      # Enable notmuch for indexing and searching
      notmuch.enable = true;

      # Enable neomutt for this account
      neomutt = {
        enable = true;
        extraMailboxes = [ "Archive" "Drafts" "Sent" "Spam" "Trash" ];
      };
    };
  };

  # Offlineimap global configuration
  programs.offlineimap = {
    enable = true;
    extraConfig.general = {
      # UI type
      ui = "ttyui";
      # Path to Python file with auxiliary functions
      pythonfile = "${config.home.homeDirectory}/.offlineimap.py";
      # Sync both accounts
      accounts = "protonmail,fastmail";
      # Number of accounts to sync simultaneously (do them one at a time to avoid conflicts)
      maxsyncaccounts = 1;
    };
  };

  # Copy offlineimap Python helper
  home.file.".offlineimap.py".source = ./dotfiles/offlineimap.py;

  # Notmuch configuration for email indexing and searching
  programs.notmuch = {
    enable = true;

    hooks = {
      # Re-index after sync
      postNew = ''
        # Tag new mail
        notmuch tag +inbox +unread -- tag:new

        # Tag by folder
        notmuch tag +sent -inbox -- folder:Sent
        notmuch tag +drafts -inbox -- folder:Drafts
        notmuch tag +spam -inbox -- folder:Spam
        notmuch tag +trash -inbox -- folder:Trash
        notmuch tag +archive -inbox -- folder:Archive

        # Remove 'new' tag
        notmuch tag -new -- tag:new
      '';
    };

    new.tags = [ "new" ];

    search = {
      excludeTags = [ "deleted" "spam" ];
    };

    extraConfig = {
      database = {
        path = maildir;
      };
      user = {
        name = "William Rose";
        primary_email = "will@williamro.se";
      };
      search = {
        exclude_tags = "deleted;spam;";
      };
    };
  };

  # Neomutt configuration
  programs.neomutt = {
    enable = true;

    vimKeys = true;

    # Use notmuch for searching
    sidebar = {
      enable = true;
      width = 30;
    };

    settings = {
      # Use notmuch as virtual mailboxes
      nm_default_url = "notmuch://${maildir}";
      virtual_spoolfile = "yes";

      # Maildir settings
      mbox_type = "Maildir";

      # Sorting
      sort = "threads";
      sort_aux = "reverse-last-date-received";

      # Index format
      index_format = "%4C %Z %{%b %d} %-15.15L (%?l?%4l&%4c?) %s";

      # Colors and UI
      menu_scroll = "yes";
      markers = "no";
      pager_index_lines = "10";
      pager_context = "5";

      # Composition
      edit_headers = "yes";
      autoedit = "yes";

      # Speed up folder switching
      sleep_time = "0";
      mail_check = "60";
      timeout = "10";

      # Don't mark old
      mark_old = "no";
    };

    binds = [
      # Notmuch search bindings
      { map = [ "index" "pager" ]; key = "\\\\"; action = "vfolder-from-query"; }
      { map = [ "index" ]; key = "X"; action = "vfolder-from-query"; }

      # Sidebar navigation
      { map = [ "index" "pager" ]; key = "\\Ck"; action = "sidebar-prev"; }
      { map = [ "index" "pager" ]; key = "\\Cj"; action = "sidebar-next"; }
      { map = [ "index" "pager" ]; key = "\\Co"; action = "sidebar-open"; }
      { map = [ "index" "pager" ]; key = "\\Cp"; action = "sidebar-prev-new"; }
      { map = [ "index" "pager" ]; key = "\\Cn"; action = "sidebar-next-new"; }
      { map = [ "index" "pager" ]; key = "B"; action = "sidebar-toggle-visible"; }
    ];

    macros = [
      # Quick notmuch searches
      {
        map = [ "index" ];
        key = "gi";
        action = "<change-vfolder>notmuch://?query=tag:inbox<enter>";
      }
      {
        map = [ "index" ];
        key = "gu";
        action = "<change-vfolder>notmuch://?query=tag:unread<enter>";
      }
      {
        map = [ "index" ];
        key = "gs";
        action = "<change-vfolder>notmuch://?query=tag:sent<enter>";
      }
      {
        map = [ "index" ];
        key = "ga";
        action = "<change-vfolder>notmuch://?query=tag:archive<enter>";
      }

      # URL scanning
      {
        map = [ "index" "pager" ];
        key = "\\Cu";
        action = "<pipe-message> urlscan<Enter>";
      }
    ];

    extraConfig = ''
      # Notmuch virtual mailboxes
      virtual-mailboxes \
        "Inbox"     "notmuch://?query=tag:inbox" \
        "Unread"    "notmuch://?query=tag:unread" \
        "Sent"      "notmuch://?query=tag:sent" \
        "Drafts"    "notmuch://?query=tag:drafts" \
        "Archive"   "notmuch://?query=tag:archive"

      # HTML email viewing
      alternative_order text/plain text/html
      auto_view text/html
      set mailcap_path = ~/.mailcap

      # Cache settings
      set header_cache = "~/.cache/neomutt/headers"
      set message_cachedir = "~/.cache/neomutt/bodies"

      # Compose settings
      set editor = "nvim"
      set use_from = yes
      set envelope_from = yes

      # Security
      set ssl_force_tls = yes
      set ssl_starttls = yes

      # Account-specific SMTP and certificates are handled by home-manager per account
    '';
  };

  # Mailcap for HTML email viewing
  home.file.".mailcap".text = ''
    text/html; lynx -assume_charset=%{charset} -display_charset=utf-8 -dump %s; nametemplate=%s.html; copiousoutput
    text/html; w3m -I %{charset} -T text/html; copiousoutput
  '';

  # Create cache directories for neomutt
  home.activation.createNeomuttCache = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    $DRY_RUN_CMD mkdir -p $VERBOSE_ARG "${config.home.homeDirectory}/.cache/neomutt/headers"
    $DRY_RUN_CMD mkdir -p $VERBOSE_ARG "${config.home.homeDirectory}/.cache/neomutt/bodies"
  '';

  # Wrapper script for offlineimap that refreshes certificate first
  home.file.".local/bin/offlineimap-sync" = {
    text = ''
      #!/usr/bin/env bash
      # Refresh Bridge certificate before syncing
      ${config.home.homeDirectory}/.dotfiles/scripts/refresh-bridge-cert.sh 2>/dev/null
      # Run offlineimap
      exec ${pkgs.offlineimap}/bin/offlineimap "$@"
    '';
    executable = true;
  };

  # Create .local/bin directory
  home.activation.createLocalBin = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    $DRY_RUN_CMD mkdir -p $VERBOSE_ARG "${config.home.homeDirectory}/.local/bin"
  '';

  # Launchd service for automatic email syncing on macOS
  launchd.agents.offlineimap = {
    enable = true;
    config = {
      ProgramArguments = [ "${config.home.homeDirectory}/.local/bin/offlineimap-sync" "-u" "quiet" ];
      StartInterval = 300; # Run every 5 minutes
      RunAtLoad = true;
      StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/offlineimap.log";
      StandardOutPath = "${config.home.homeDirectory}/Library/Logs/offlineimap.log";
      EnvironmentVariables = {
        PATH = "${pkgs.offlineimap}/bin:${pkgs.notmuch}/bin:${pkgs.openssl}/bin:/usr/bin:/bin";
        HOME = "${config.home.homeDirectory}";
      };
    };
  };
}

# ProjectShell mobile capabilities

The mobile adapter injects repository-owned SSH client commands and the
isolated QuickJS runtime into `@boltpocket/project-shell`. None of these commands
starts an Android/iOS system shell.

## SSH/SFTP

`createSshProjectShellCommands` registers `ssh`, `scp`, and `sftp`.
Targets are current-project command aliases; native session IDs, pinned hosts,
and remote start directories come from device-secure SSH command profiles. The
first-class Agent `sshpass` tool extracts the selected authorized secret from
the device password book at invocation time and creates that native session.
SSH is not a connector and does not create project resources. Credentials and
endpoints are never accepted on the command line.

Supported syntax:

```text
ssh <alias> diagnose
ssh <alias> [--] '<remote-command>'
sftp <alias> ls [remote-directory]
sftp <alias> cat <remote-file>
sftp <alias> get <remote-file> <existing-project-file>
scp <alias>:<remote-file> <existing-project-file>
```

The transport exposes complete non-interactive remote command execution plus
the structured `diagnose`, `stat`, `list`, and `readText` operations. A command
may receive piped standard input and may use the remote account's shell syntax,
including pipelines and redirections. Remote command and path authorization is
decided by the authenticated account and server configuration; the app adds no
remote command-category or filesystem-directory policy. The saved login
directory is only the starting point for relative paths.

The structured SFTP/SCP forms above remain useful for bounded text downloads.
A download may target only an explicitly selected existing project resource
and writes only the ProjectShell overlay, so it becomes the ordinary unified
Diff. Other remote filesystem operations can be performed through `ssh`.

`ssh <alias> diagnose` runs the repository-owned Linux health-check shortcut.
It reports OS/kernel, CPU/load/uptime, memory/swap, capacity/inodes, processes,
addresses, ports, failed systemd units, and recent high-priority journal
entries. Ordinary remote administration uses `ssh <alias> -- '<command>'`.
Each command is non-interactive and currently has a 60-second timeout, 1 MB
standard-input limit, and 1 MB combined-output limit. A timeout does not prove
that a remote mutation did not occur.

The bundled `operate-ssh` Skill applies a mandatory lockout-prevention protocol
to SSH ports, firewalls, routing, authentication, service control, and reboots.
It requires an auditable patch and recovery point, a verified server-side
automatic rollback, additive rollout that retains the old entry point, and a
fresh independent client connection before rollback can be cancelled.

`sshpass` is a first-class Agent tool, not a just-bash command. It receives an
authorized credential ID and extracts the matching password or private key from
the password book only when invoked. Android and iOS then authenticate through
the native libssh2 module; no OpenSSH or system `sshpass` child process is
launched, and the secret never enters Agent-visible arguments.

`createBoltPocketSshProjectShellTransport()` lazily maps the repository
`@boltpocket/expo-ssh` module onto the command and file-operation port. Native
failures are converted to stable redacted codes.

## JavaScript

`createBoltPocketQuickJsProjectShellRuntime()` lazily maps `js-exec` to the native
`@boltpocket/expo-quickjs` module. Every invocation receives a fresh bounded
QuickJS context. Its JSON-only `input` contains args, cwd, piped stdin, and only
the project text snapshots explicitly selected with `--input-file`; it has no
modules, filesystem bridge, network, timers, host eval, or direct writes. The
same adapter backs the Agent's first-class `js_exec` calculation tool, whose
project-file list is also explicit and read-only.

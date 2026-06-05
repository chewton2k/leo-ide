use portable_pty::CommandBuilder;

/// Resolve the user's shell: `$SHELL`, else a per-OS default.
pub fn default_shell() -> String {
    if let Ok(s) = std::env::var("SHELL") {
        if !s.is_empty() {
            return s;
        }
    }
    #[cfg(target_os = "macos")]
    {
        "/bin/zsh".to_string()
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        "/bin/bash".to_string()
    }
    #[cfg(windows)]
    {
        "powershell.exe".to_string()
    }
}

/// Arguments that make `shell_path` run as a login/interactive shell so it
/// sources the user's startup files. Unknown shells get no args (spawned bare).
pub fn login_args(shell_path: &str) -> Vec<String> {
    let base = shell_path.rsplit(['/', '\\']).next().unwrap_or("");
    let name = base
        .strip_suffix(".exe")
        .unwrap_or(base)
        .to_ascii_lowercase();
    match name.as_str() {
        // login (sources /etc/zprofile -> path_helper, .zprofile, .zshrc on tty)
        "zsh" => vec!["-l".to_string()],
        // bash ignores .bashrc under -l alone; -i sources it, -l adds profile
        "bash" => vec!["-l".to_string(), "-i".to_string()],
        // fish reads config.fish automatically; -i marks it interactive
        "fish" => vec!["-i".to_string()],
        "sh" | "dash" | "ksh" => vec!["-l".to_string()],
        _ => vec![],
    }
}

/// Build a `CommandBuilder` for the user's login shell, injecting leo's shell
/// integration (OSC 7 cwd + OSC 133 prompt markers) when the shell is
/// supported. Integration is best-effort: if the rc scripts can't be written,
/// we fall back to a plain login shell so the terminal always works.
pub fn build_login_command() -> CommandBuilder {
    let shell = default_shell();
    let mut cmd = CommandBuilder::new(&shell);
    #[cfg(unix)]
    {
        if !integration::apply(&mut cmd, &shell) {
            for arg in login_args(&shell) {
                cmd.arg(arg);
            }
        }
    }
    #[cfg(not(unix))]
    {
        for arg in login_args(&shell) {
            cmd.arg(arg);
        }
    }
    cmd
}

/// Shell base name without path or `.exe` suffix, lowercased.
fn shell_base_name(shell_path: &str) -> String {
    let base = shell_path.rsplit(['/', '\\']).next().unwrap_or("");
    base.strip_suffix(".exe")
        .unwrap_or(base)
        .to_ascii_lowercase()
}

/// for zsh we point `ZDOTDIR` at a generated dir whose rc files source the
/// user's real ones and then install precmd/preexec hooks that emit OSC 7/133;
/// for bash we pass `--rcfile`; for fish we drop a `conf.d` snippet.
#[cfg(unix)]
mod integration {
    use std::ffi::OsString;
    use std::fs;
    use std::path::{Path, PathBuf};

    use portable_pty::CommandBuilder;

    const ZSHENV: &str = include_str!("scripts/zshenv.zsh");
    const ZPROFILE: &str = include_str!("scripts/zprofile.zsh");
    const ZLOGIN: &str = include_str!("scripts/zlogin.zsh");
    const ZSHRC: &str = include_str!("scripts/zshrc.zsh");
    const BASHRC: &str = include_str!("scripts/bashrc.bash");
    const FISH_INIT: &str = include_str!("scripts/init.fish");

    /// Apply integration to `cmd`. Returns true if integration (and the shell's
    /// args) were set up; false to let the caller fall back to a plain shell.
    pub fn apply(cmd: &mut CommandBuilder, shell_path: &str) -> bool {
        match super::shell_base_name(shell_path).as_str() {
            "zsh" => match prepare_zdotdir() {
                Ok(zdotdir) => {
                    // Guard against leo-in-leo: preserve the user's ZDOTDIR.
                    if let Ok(user_zd) = std::env::var("ZDOTDIR") {
                        if Path::new(&user_zd) != zdotdir.as_path() {
                            cmd.env("LEO_USER_ZDOTDIR", user_zd);
                        }
                    }
                    cmd.env("ZDOTDIR", &zdotdir);
                    // Login shell so /etc/zprofile runs path_helper on macOS.
                    cmd.arg("-l");
                    true
                }
                Err(_) => false,
            },
            "bash" => match prepare_bash_rcfile() {
                Ok(rc) => {
                    // bash ignores --rcfile under -l, so use -i and source
                    // /etc/profile from inside the rcfile to emulate login init.
                    cmd.arg("--rcfile");
                    cmd.arg(rc);
                    cmd.arg("-i");
                    true
                }
                Err(_) => false,
            },
            "fish" => match prepare_fish_conf_d() {
                Ok(()) => {
                    cmd.arg("-i");
                    true
                }
                Err(_) => false,
            },
            _ => false,
        }
    }

    fn integration_root() -> Result<PathBuf, String> {
        let home = dirs::home_dir().ok_or_else(|| "no home dir".to_string())?;
        let root = home.join(".cache").join("leo").join("shell-integration");
        fs::create_dir_all(&root).map_err(|e| format!("create {}: {e}", root.display()))?;
        Ok(root)
    }

    fn prepare_zdotdir() -> Result<PathBuf, String> {
        let dir = integration_root()?.join("zsh");
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        write_if_changed(&dir.join(".zshenv"), ZSHENV)?;
        write_if_changed(&dir.join(".zprofile"), ZPROFILE)?;
        write_if_changed(&dir.join(".zshrc"), ZSHRC)?;
        write_if_changed(&dir.join(".zlogin"), ZLOGIN)?;
        Ok(dir)
    }

    fn prepare_bash_rcfile() -> Result<PathBuf, String> {
        let dir = integration_root()?.join("bash");
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        let rc = dir.join("bashrc");
        write_if_changed(&rc, BASHRC)?;
        Ok(rc)
    }

    fn prepare_fish_conf_d() -> Result<(), String> {
        let home = dirs::home_dir().ok_or_else(|| "no home dir".to_string())?;
        let dir = home.join(".config").join("fish").join("conf.d");
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        write_if_changed(&dir.join("leo.fish"), FISH_INIT)?;
        Ok(())
    }

    /// Write `content` only if different. Atomic replace so a parallel shell
    /// startup never sources a half-written file.
    pub fn write_if_changed(path: &Path, content: &str) -> Result<(), String> {
        if let Ok(existing) = fs::read_to_string(path) {
            if existing == content {
                return Ok(());
            }
        }
        let mut tmp: OsString = path.as_os_str().to_owned();
        tmp.push(".__leo_tmp__");
        let tmp = PathBuf::from(tmp);
        fs::write(&tmp, content).map_err(|e| format!("write {}: {e}", tmp.display()))?;
        fs::rename(&tmp, path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("rename {} -> {}: {e}", tmp.display(), path.display())
        })
    }

    /// Non-empty guard so a botched script edit can't silently ship an empty
    /// integration file.
    #[cfg(test)]
    pub const SCRIPTS: [&str; 6] = [ZSHENV, ZPROFILE, ZLOGIN, ZSHRC, BASHRC, FISH_INIT];
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zsh_is_login() {
        assert_eq!(login_args("/bin/zsh"), vec!["-l"]);
        assert_eq!(login_args("/opt/homebrew/bin/zsh"), vec!["-l"]);
    }

    #[test]
    fn bash_is_login_interactive() {
        assert_eq!(login_args("/usr/bin/bash"), vec!["-l", "-i"]);
    }

    #[test]
    fn fish_is_interactive() {
        assert_eq!(login_args("/usr/local/bin/fish"), vec!["-i"]);
    }

    #[test]
    fn posix_shells_are_login() {
        assert_eq!(login_args("/bin/sh"), vec!["-l"]);
        assert_eq!(login_args("/bin/dash"), vec!["-l"]);
    }

    #[test]
    fn unknown_shell_gets_no_args() {
        assert!(login_args("/usr/bin/nu").is_empty());
        assert!(login_args(r"C:\Program Files\PowerShell\pwsh.exe").is_empty());
    }

    #[test]
    fn strips_exe_suffix_and_path() {
        // A Windows-style zsh path still resolves to the zsh rule.
        assert_eq!(login_args(r"C:\msys64\usr\bin\zsh.exe"), vec!["-l"]);
    }

    #[test]
    fn default_shell_is_non_empty() {
        assert!(!default_shell().is_empty());
    }

    #[test]
    fn shell_base_name_strips_path_and_exe() {
        assert_eq!(super::shell_base_name("/bin/zsh"), "zsh");
        assert_eq!(super::shell_base_name("/opt/homebrew/bin/fish"), "fish");
        assert_eq!(super::shell_base_name("/usr/bin/BASH"), "bash");
        assert_eq!(super::shell_base_name(r"C:\msys64\usr\bin\zsh.exe"), "zsh");
        // Paths with spaces still resolve to the base shell name.
        assert_eq!(super::shell_base_name("/usr/local/my shells/zsh"), "zsh");
        assert_eq!(super::shell_base_name("fish"), "fish");
    }

    #[cfg(unix)]
    #[test]
    fn integration_scripts_emit_osc_and_are_non_empty() {
        for s in super::integration::SCRIPTS {
            assert!(!s.trim().is_empty(), "an integration script is empty");
        }
        // The zsh + bash + fish scripts must emit OSC 7 (cwd) so the host can
        // follow `cd`. OSC 7 in the scripts is written as the `]7;file://` payload.
        let osc7_emitters = super::integration::SCRIPTS
            .iter()
            .filter(|s| s.contains("]7;file://"))
            .count();
        assert!(osc7_emitters >= 3, "expected zsh/bash/fish to emit OSC 7");
    }

    #[cfg(unix)]
    #[test]
    fn write_if_changed_writes_then_skips() {
        use std::path::PathBuf;
        let mut p: PathBuf = std::env::temp_dir();
        p.push(format!("leo_shell_init_test_{}.txt", std::process::id()));
        let _ = std::fs::remove_file(&p);
        super::integration::write_if_changed(&p, "alpha").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "alpha");
        // Second identical write is a no-op (must not error).
        super::integration::write_if_changed(&p, "alpha").unwrap();
        // Changed content is rewritten.
        super::integration::write_if_changed(&p, "beta").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "beta");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn edge_cases() {
        assert!(login_args("").is_empty());
        assert!(login_args("powershell").is_empty());
        // Shell name matching is case-insensitive.
        assert_eq!(login_args("/bin/ZSH"), vec!["-l"]);
        assert_eq!(login_args("BASH"), vec!["-l", "-i"]);
    }
}

//! Backend command-safety policy.
//!
//! The agent's `run_command`/`run_background` tools and the self-verify loop
//! execute shell commands via the backend. The frontend has an approval hook,
//! but a compromised webview or a prompt-injected agent could call the
//! backend commands directly. This module provides an always-on, backend-side
//! denylist for *catastrophic* commands — ones whose obvious purpose is the
//! irreversible destruction of the user's system or data.
//!
//! The list is intentionally conservative: it targets unambiguous footguns
//! (`rm -rf /`, fork bombs, raw-device writes, `mkfs`) and must NOT reject
//! ordinary developer commands. It is a safety backstop, not a sandbox.

/// Returns true when `command` matches a catastrophic, irreversible pattern
/// that should be refused regardless of working directory.
pub fn is_catastrophic_command(command: &str) -> bool {
    let lower = command.to_ascii_lowercase();
    let collapsed: String = lower.split_whitespace().collect::<Vec<_>>().join(" ");
    let nospace: String = lower.chars().filter(|c| !c.is_whitespace()).collect();

    // Classic fork bomb, with or without internal spaces.
    if nospace.contains(":(){:|:&};:") {
        return true;
    }

    // Filesystem creation over an existing device wipes it.
    if collapsed.contains("mkfs") {
        return true;
    }

    // Raw block-device writes (dd of=, or shell redirection into a device).
    let writes_to_device = collapsed.contains("of=/dev/")
        || collapsed.contains("> /dev/")
        || collapsed.contains(">/dev/");
    if writes_to_device
        && ["/dev/sd", "/dev/disk", "/dev/nvme", "/dev/hd", "/dev/rdisk"]
            .iter()
            .any(|d| collapsed.contains(d))
    {
        return true;
    }

    is_catastrophic_rm(&collapsed)
}

/// Detect `rm` invocations that recursively+forcibly target the filesystem
/// root or the user's home directory.
fn is_catastrophic_rm(cmd_lower: &str) -> bool {
    for segment in cmd_lower.split(|c| c == ';' || c == '&' || c == '|') {
        let tokens: Vec<&str> = segment.split_whitespace().collect();
        let Some(pos) = tokens.iter().position(|t| *t == "rm") else {
            continue;
        };
        let mut recursive = false;
        let mut force = false;
        let mut targets: Vec<&str> = Vec::new();
        for a in &tokens[pos + 1..] {
            if let Some(long) = a.strip_prefix("--") {
                match long {
                    "recursive" => recursive = true,
                    "force" => force = true,
                    _ => {}
                }
            } else if a.starts_with('-') {
                // Combined short flags: -rf, -fr, -Rf, etc.
                if a.contains('r') {
                    recursive = true;
                }
                if a.contains('f') {
                    force = true;
                }
            } else {
                targets.push(a);
            }
        }
        if recursive && force && targets.iter().any(|t| is_root_or_home_target(t)) {
            return true;
        }
    }
    false
}

fn is_root_or_home_target(t: &str) -> bool {
    let t = t.trim_matches('"').trim_matches('\'');
    matches!(
        t,
        "/" | "/*" | "~" | "~/" | "~/*" | "$home" | "$home/" | "$home/*" | "/."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_rm_rf_root_and_home() {
        assert!(is_catastrophic_command("rm -rf /"));
        assert!(is_catastrophic_command("rm -fr /"));
        assert!(is_catastrophic_command("rm -rf /*"));
        assert!(is_catastrophic_command("sudo rm -rf /"));
        assert!(is_catastrophic_command("rm -rf ~"));
        assert!(is_catastrophic_command("rm -rf ~/"));
        assert!(is_catastrophic_command("rm -rf $HOME"));
        assert!(is_catastrophic_command("rm --recursive --force /"));
        assert!(is_catastrophic_command("rm -rf --no-preserve-root /"));
    }

    #[test]
    fn blocks_fork_bomb_forkbomb_and_device_writes() {
        assert!(is_catastrophic_command(":(){ :|:& };:"));
        assert!(is_catastrophic_command(":(){:|:&};:"));
        assert!(is_catastrophic_command("mkfs.ext4 /dev/sda1"));
        assert!(is_catastrophic_command("dd if=/dev/zero of=/dev/sda bs=1M"));
        assert!(is_catastrophic_command("echo x > /dev/sda"));
    }

    #[test]
    fn allows_ordinary_developer_commands() {
        assert!(!is_catastrophic_command("rm -rf node_modules"));
        assert!(!is_catastrophic_command("rm -rf ./dist"));
        assert!(!is_catastrophic_command("rm -rf target"));
        assert!(!is_catastrophic_command("rm -rf build/ .cache"));
        assert!(!is_catastrophic_command("rm file.txt"));
        assert!(!is_catastrophic_command("cargo build --release"));
        assert!(!is_catastrophic_command("git clean -fdx"));
        assert!(!is_catastrophic_command("npm install && npm test"));
        assert!(!is_catastrophic_command("dd if=src.img of=out.img"));
        assert!(!is_catastrophic_command("grep -rf pattern ."));
    }

    #[test]
    fn rm_without_both_flags_is_not_catastrophic() {
        // Missing force, or missing recursive — not the classic footgun.
        assert!(!is_catastrophic_command("rm -r /"));
        assert!(!is_catastrophic_command("rm -f /"));
    }
}

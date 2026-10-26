// `browser help` is the first command an agent tries, so it must print the
// action table from commands::docs, not clap's subcommand list.

use std::process::Command;

fn run(args: &[&str]) -> String {
    let output = Command::new(env!("CARGO_BIN_EXE_browser"))
        .args(args)
        .output()
        .expect("failed to run the browser binary");
    assert!(
        output.status.success(),
        "`browser {}` failed: {}",
        args.join(" "),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).into_owned()
}

#[test]
fn help_prints_the_action_table() {
    let stdout = run(&["help"]);
    assert!(
        stdout.contains("ACTIONS:"),
        "`browser help` did not print the action table:\n{stdout}"
    );
    assert!(
        !stdout.contains("Commands:"),
        "clap's subcommand help took over `browser help`:\n{stdout}"
    );
    for action in ["navigate", "getContent", "setActiveTab", "ping"] {
        assert!(
            stdout.contains(action),
            "`browser help` does not advertise {action}:\n{stdout}"
        );
    }
}

#[test]
fn no_argument_invocation_matches_help() {
    assert_eq!(run(&[]), run(&["help"]));
}

// `help` is a subcommand of its own now, so a trailing word must be rejected
// instead of reaching the subcommand that shares its name. Without this, a
// parser change that turned `help` back into an action word would make
// `browser help setup` install skill files.
#[test]
fn help_rejects_a_trailing_subcommand() {
    let output = Command::new(env!("CARGO_BIN_EXE_browser"))
        .args(["help", "setup"])
        .output()
        .expect("failed to run the browser binary");
    assert!(
        !output.status.success(),
        "`browser help setup` should be rejected, got:\n{}",
        String::from_utf8_lossy(&output.stdout)
    );
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("unexpected argument"),
        "`browser help setup` should fail clap parsing, got:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn clap_help_points_at_the_action_list() {
    let output = Command::new(env!("CARGO_BIN_EXE_browser"))
        .arg("--help")
        .output()
        .expect("failed to run the browser binary");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.contains("browser help"),
        "`browser --help` should point at `browser help`:\n{stdout}"
    );
}

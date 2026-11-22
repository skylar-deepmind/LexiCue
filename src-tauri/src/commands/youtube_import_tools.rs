use super::youtube_attempt::{run_tool, version_number, Failure, Trace};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::process::Command;

pub(super) struct Tool {
    pub(super) path: PathBuf,
}

pub(super) struct Tools {
    pub(super) ytdlp: Tool,
    pub(super) ffmpeg: Tool,
    pub(super) ffprobe: Result<Tool, Failure>,
    runtime: &'static str,
    js: Tool,
}

impl Tool {
    fn paths(name: &str) -> impl Iterator<Item = PathBuf> + '_ {
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let user_paths = home
            .into_iter()
            .flat_map(|home| [home.join(".deno/bin"), home.join("Library/pnpm")]);
        let search_path = std::env::var_os("PATH");
        let runtime_paths = matches!(name, "deno" | "node").then(|| {
            user_paths
                .chain(search_path.iter().flat_map(std::env::split_paths))
                .collect::<Vec<_>>()
        });
        ["/opt/homebrew/bin", "/usr/local/bin"]
            .into_iter()
            .map(PathBuf::from)
            .chain(runtime_paths.into_iter().flatten())
            .filter(|path| path.is_absolute())
            .map(move |path| path.join(name))
    }

    async fn find(
        name: &'static str,
        minimum: Option<[u32; 3]>,
        trace: &Trace,
    ) -> Result<Self, Failure> {
        let version_flag = if matches!(name, "ffmpeg" | "ffprobe") {
            "-version"
        } else {
            "--version"
        };
        trace
            .step(name, Duration::from_secs(4), false, || async {
                let mut seen = std::collections::HashSet::new();
                let mut failure = Failure::ToolMissing;
                for path in
                    Self::paths(name).filter(|path| path.is_file() && seen.insert(path.clone()))
                {
                    let mut command = Command::new(&path);
                    command.arg(version_flag);
                    match run_tool(command, 8192, |_| {}).await {
                        Ok(output) => {
                            if let Some(version) = version_number(&output.stdout) {
                                trace.tool(name, version);
                                if minimum.is_none_or(|minimum| compatible(version, minimum)) {
                                    return Ok(Self { path });
                                }
                            }
                            failure = Failure::ToolIncompatible;
                        }
                        Err(reason) => failure = reason,
                    }
                }
                Err(failure)
            })
            .await
    }
}

fn compatible(version: &str, minimum: [u32; 3]) -> bool {
    let mut parts = version.split('.').map(|part| part.parse::<u32>());
    let actual = [(); 3].map(|()| parts.next().and_then(Result::ok));
    match actual {
        [Some(major), Some(minor), Some(patch)] => [major, minor, patch] >= minimum,
        _ => false,
    }
}

impl Tools {
    pub(super) async fn find(trace: &Trace) -> Result<Self, Failure> {
        // These are local probes. A missing ffprobe only disables original audio.
        let (ytdlp, ffmpeg, ffprobe, js) = tokio::join!(
            Tool::find("yt-dlp", None, trace),
            Tool::find("ffmpeg", None, trace),
            Tool::find("ffprobe", None, trace),
            async {
                // Minimum supported versions from yt-dlp's EJS setup guide.
                if let Ok(deno) = Tool::find("deno", Some([2, 3, 0]), trace).await {
                    return Ok(("deno", deno));
                }
                Tool::find("node", Some([22, 0, 0]), trace)
                    .await
                    .map(|node| ("node", node))
            }
        );
        let (runtime, js) = js?;
        Ok(Self {
            ytdlp: ytdlp?,
            ffmpeg: ffmpeg?,
            ffprobe,
            runtime,
            js,
        })
    }

    pub(super) fn downloader(&self, directory: &Path) -> Command {
        let mut command = Command::new(&self.ytdlp.path);
        let mut runtime = std::ffi::OsString::from(self.runtime);
        runtime.push(":");
        runtime.push(&self.js.path);
        command
            .env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
            .current_dir(directory)
            .args([
                "--ignore-config",
                "--no-plugin-dirs",
                "--no-cache-dir",
                "--no-playlist",
                "--socket-timeout",
                "12",
                // The import owns retry counts, deadlines and 429 handling.
                "--retries",
                "0",
                "--fragment-retries",
                "0",
                "--extractor-retries",
                "0",
                "--file-access-retries",
                "0",
                "--abort-on-unavailable-fragments",
                "--no-js-runtimes",
                "--js-runtimes",
            ])
            .arg(runtime);
        command
    }
}

#[cfg(test)]
impl Tools {
    pub(super) fn fixture(path: PathBuf, ffprobe: Result<PathBuf, Failure>) -> Self {
        let tool = |path| Tool { path };
        Self {
            ytdlp: tool(path.clone()),
            ffmpeg: tool(path.clone()),
            ffprobe: ffprobe.map(tool),
            runtime: "deno",
            js: tool(path),
        }
    }
}

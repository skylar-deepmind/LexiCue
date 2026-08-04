#[tokio::main]
async fn main() {
    let yt = youtube_transcript::YoutubeBuilder::default().build();
    match yt.transcript("https://www.youtube.com/watch?v=dQw4w9WgXcQ").await {
        Ok(t) => println!("OK segments={}", t.transcripts.len()),
        Err(e) => println!("ERR: {e}"),
    }
}

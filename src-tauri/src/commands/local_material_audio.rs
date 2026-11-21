//! Decode the first playable audio track of user-provided media. The output is a
//! bounded PCM file supported by desktop and mobile webviews.
use super::{materials, source_media};
use crate::db::DbState;
use base64::Engine;
use std::{
    fs::{File, OpenOptions},
    io::{BufWriter, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};
use symphonia::core::{
    audio::SampleBuffer,
    codecs::{CodecParameters, Decoder, DecoderOptions, CODEC_TYPE_NULL, CODEC_TYPE_OPUS},
    errors::Error as AudioError,
    formats::{FormatOptions, Packet},
    io::{MediaSource, MediaSourceStream, MediaSourceStreamOptions},
    meta::MetadataOptions,
    probe::Hint,
};
use tauri::{AppHandle, State};

const AUDIO_ERROR: &str = "material_package_audio";
const MAX_INPUT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_DURATION_MS: i64 = 7_200_000;

pub(super) fn staging_path(root: &Path, operation_id: &str) -> Result<PathBuf, String> {
    let id = uuid::Uuid::parse_str(operation_id).map_err(|_| AUDIO_ERROR)?;
    Ok(root.join(format!(".part-import-{id}")))
}

#[tauri::command]
pub async fn upload_local_material_audio(
    app: AppHandle,
    operation_id: String,
    offset: u64,
    chunk: String,
) -> Result<(), String> {
    let staging = staging_path(&source_media::root(&app)?, &operation_id)?;
    tauri::async_runtime::spawn_blocking(move || write_chunk(&staging, offset, &chunk))
        .await
        .map_err(|e| e.to_string())?
}

pub(super) fn write_chunk(staging: &Path, offset: u64, chunk: &str) -> Result<(), String> {
    if chunk.len() > 1_398_104 || offset >= MAX_INPUT_BYTES {
        return Err(AUDIO_ERROR.into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(chunk)
        .map_err(|_| AUDIO_ERROR)?;
    if bytes.is_empty() || offset + bytes.len() as u64 > MAX_INPUT_BYTES {
        return Err(AUDIO_ERROR.into());
    }
    if offset == 0 {
        std::fs::create_dir_all(staging).map_err(|_| AUDIO_ERROR)?;
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create(offset == 0)
        .truncate(offset == 0)
        .open(staging.join("input"))
        .map_err(|_| AUDIO_ERROR)?;
    if file.metadata().map_err(|_| AUDIO_ERROR)?.len() != offset {
        return Err(AUDIO_ERROR.into());
    }
    file.seek(SeekFrom::Start(offset))
        .map_err(|_| AUDIO_ERROR)?;
    file.write_all(&bytes).map_err(|_| AUDIO_ERROR.into())
}

#[tauri::command]
pub async fn discard_local_material_audio(
    app: AppHandle,
    operation_id: String,
) -> Result<(), String> {
    let staging = staging_path(&source_media::root(&app)?, &operation_id)?;
    let _ = std::fs::remove_dir_all(staging);
    Ok(())
}

#[tauri::command]
pub async fn import_material_with_local_audio(
    app: AppHandle,
    state: State<'_, DbState>,
    input: materials::MaterialInput,
) -> Result<materials::ImportResult, String> {
    let staging = source_media::Temp(staging_path(
        &source_media::root(&app)?,
        &input.operation_id,
    )?);
    let shared = state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let attachment = prepare_attachment(&staging.0, &input)?;
        let conn = shared.lock().map_err(|e| e.to_string())?;
        materials::import_material_with_attachment(&conn, &input, Some(&attachment))
    })
    .await
    .map_err(|e| e.to_string())?
}

pub(super) fn prepare_attachment(
    staging: &Path,
    input: &materials::MaterialInput,
) -> Result<source_media::LocalAttachment, String> {
    if input.source.is_some()
        || !input
            .document
            .as_ref()
            .is_some_and(|doc| matches!(doc.original_format.as_str(), "srt" | "vtt"))
    {
        return Err("material_invalid_document".into());
    }
    let path = staging.join("input");
    let file = File::open(&path).map_err(|_| AUDIO_ERROR)?;
    let len = file.metadata().map_err(|_| AUDIO_ERROR)?.len();
    if !(1..=MAX_INPUT_BYTES).contains(&len) {
        return Err(AUDIO_ERROR.into());
    }
    let input_hash = source_media::file_digest(&path).map_err(|_| AUDIO_ERROR)?;
    let wav = staging.join("audio.wav");
    let duration = decode_audio(Box::new(file), &wav)?;
    source_media::LocalAttachment::new(input, &wav, duration, input_hash)
}

enum TrackDecoder {
    Native(Box<dyn Decoder>, Option<SampleBuffer<f32>>),
    Opus {
        decoder: Box<rusty_opus::OpusDecoder>,
        samples: Vec<f32>,
        channels: usize,
        delay: usize,
    },
}

impl TrackDecoder {
    fn new(params: &CodecParameters) -> Option<Self> {
        if params.codec == CODEC_TYPE_OPUS {
            // Opus in both Matroska and Ogg carries an OpusHead codec header.
            let header = params.extra_data.as_deref().filter(|data| {
                data.len() >= 19 && data.starts_with(b"OpusHead") && data[18] == 0
            })?;
            let channels = usize::from(header[9]);
            let decoder = rusty_opus::OpusDecoder::new(48_000, channels).ok()?;
            return Some(Self::Opus {
                decoder: Box::new(decoder),
                samples: vec![0.0; 5760 * channels],
                channels,
                delay: usize::from(u16::from_le_bytes([header[10], header[11]])),
            });
        }
        symphonia::default::get_codecs()
            .make(params, &DecoderOptions::default())
            .ok()
            .map(|decoder| Self::Native(decoder, None))
    }

    fn decode(&mut self, packet: &Packet) -> Result<(&[f32], u32, usize), String> {
        match self {
            Self::Native(decoder, buffer) => {
                let decoded = decoder.decode(packet).map_err(|_| AUDIO_ERROR)?;
                let spec = *decoded.spec();
                let channels = spec.channels.count();
                if !(8_000..=192_000).contains(&spec.rate) || channels == 0 {
                    return Err(AUDIO_ERROR.into());
                }
                if buffer
                    .as_ref()
                    .is_none_or(|buffer| buffer.capacity() < decoded.capacity() * channels)
                {
                    *buffer = Some(SampleBuffer::new(decoded.capacity() as u64, spec));
                }
                let buffer = buffer.as_mut().ok_or(AUDIO_ERROR)?;
                buffer.copy_interleaved_ref(decoded);
                Ok((buffer.samples(), spec.rate, channels))
            }
            Self::Opus {
                decoder,
                samples,
                channels,
                delay,
            } => {
                let frames = decoder
                    .decode(packet.buf(), 5760, samples)
                    .map_err(|_| AUDIO_ERROR)?;
                let start = (*delay).min(frames);
                *delay -= start;
                Ok((
                    &samples[start * *channels..frames * *channels],
                    48_000,
                    *channels,
                ))
            }
        }
    }
}

fn decode_audio(source: Box<dyn MediaSource>, destination: &Path) -> Result<i64, String> {
    let stream = MediaSourceStream::new(source, MediaSourceStreamOptions::default());
    let mut media = symphonia::default::get_probe()
        .format(
            &Hint::new(),
            stream,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|_| AUDIO_ERROR)?
        .format;
    let (track_id, mut decoder) = media
        .tracks()
        .iter()
        .filter(|track| track.codec_params.codec != CODEC_TYPE_NULL)
        .find_map(|track| TrackDecoder::new(&track.codec_params).map(|decoder| (track.id, decoder)))
        .ok_or(AUDIO_ERROR)?;

    let mut output = BufWriter::new(File::create(destination).map_err(|_| AUDIO_ERROR)?);
    output.write_all(&[0; 44]).map_err(|_| AUDIO_ERROR)?;
    let mut rate = 0;
    let mut written = 0_u64;
    let mut phase = 0_u32;
    let mut sum = 0.0_f32;
    let mut count = 0_u32;
    loop {
        let packet = match media.next_packet() {
            Ok(packet) => packet,
            Err(AudioError::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(_) => return Err(AUDIO_ERROR.into()),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let (samples, sample_rate, channels) = decoder.decode(&packet)?;
        if rate == 0 {
            rate = sample_rate;
        }
        if rate != sample_rate {
            return Err(AUDIO_ERROR.into());
        }
        // Keep a mono track, downsampling high-rate content with an averaging filter.
        let output_rate = rate.min(24_000);
        for frame in samples.chunks_exact(channels) {
            sum += frame.iter().sum::<f32>() / channels as f32;
            count += 1;
            phase += output_rate;
            if phase < rate {
                continue;
            }
            phase -= rate;
            let pcm = (sum / count as f32).clamp(-1., 1.) * i16::MAX as f32;
            output
                .write_all(&(pcm as i16).to_le_bytes())
                .map_err(|_| AUDIO_ERROR)?;
            sum = 0.;
            count = 0;
            written += 1;
        }
        if written * 2 > source_media::MAX_BYTES - 44
            || written * 1000 > u64::from(output_rate) * MAX_DURATION_MS as u64
        {
            return Err(AUDIO_ERROR.into());
        }
    }
    if written == 0 {
        return Err(AUDIO_ERROR.into());
    }
    rate = rate.min(24_000);
    write_wav_header(&mut output, rate, (written * 2) as u32).map_err(|_| AUDIO_ERROR)?;
    output.flush().map_err(|_| AUDIO_ERROR)?;
    output.get_ref().sync_all().map_err(|_| AUDIO_ERROR)?;
    Ok((written * 1000).div_ceil(u64::from(rate)) as i64)
}

fn write_wav_header(output: &mut (impl Write + Seek), rate: u32, size: u32) -> std::io::Result<()> {
    output.seek(SeekFrom::Start(0))?;
    output.write_all(b"RIFF")?;
    output.write_all(&(36 + size).to_le_bytes())?;
    output.write_all(b"WAVEfmt ")?;
    output.write_all(&16_u32.to_le_bytes())?;
    output.write_all(&[1, 0, 1, 0])?; // PCM, one channel
    output.write_all(&rate.to_le_bytes())?;
    output.write_all(&(rate * 2).to_le_bytes())?;
    output.write_all(&[2, 0, 16, 0])?;
    output.write_all(b"data")?;
    output.write_all(&size.to_le_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn normalizes_local_pcm_and_rejects_undecodable_input() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("audio.wav");
        let mut input = Cursor::new(Vec::new());
        write_wav_header(&mut input, 48_000, 96_000).unwrap();
        input.write_all(&[0; 96_000]).unwrap();
        input.set_position(0);
        assert_eq!(decode_audio(Box::new(input), &target).unwrap(), 1000);
        let output = std::fs::read(&target).unwrap();
        assert_eq!(output.len(), 48_044);
        assert_eq!(&output[24..28], &24_000_u32.to_le_bytes());
        assert!(decode_audio(Box::new(Cursor::new(b"no audio")), &target).is_err());
    }
    #[test]
    fn extracts_aac_and_opus_from_real_video_containers() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("audio.wav");
        for (bytes, expected) in [
            (&include_bytes!("test_data/local-import-aac.mp4")[..], 3000),
            (
                &include_bytes!("test_data/local-import-opus.webm")[..],
                2000,
            ),
        ] {
            let duration = decode_audio(Box::new(Cursor::new(bytes)), &target).unwrap();
            assert!(
                (duration - expected).abs() < 60,
                "unexpected duration {duration}"
            );
            let data = std::fs::read(&target).unwrap();
            assert_eq!(&data[..4], b"RIFF");
            assert!(data[44..].chunks_exact(2).any(|sample| i16::from_le_bytes([
                sample[0], sample[1]
            ])
            .abs()
                > 100));
        }
    }
}

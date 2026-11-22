//! The sealed body of a `.emerald` file: the archive encrypted in chunks, so
//! that neither writing nor reading ever holds the whole file in memory and
//! the clear archive never touches the disk.
//!
//! ```text
//! chunk i = XChaCha20-Poly1305(key, nonce prefix (16) | i (u64 LE),
//!                              plain (CHUNK bytes, the last one 0..=CHUNK),
//!                              associated data: file header | last-chunk flag)
//! ```
//!
//! The file header (kind, protection, salt, nonce prefix) is bound into every
//! chunk; the counter in the nonce keeps the chunks in their order, and the
//! flag on the last one makes a file cut off at a chunk boundary fail instead
//! of reading as a shorter archive.

use std::io::{self, Read, Seek, SeekFrom, Write};

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use zeroize::Zeroizing;

use crate::crypto::Key;

/// Clear bytes per chunk.
pub(crate) const CHUNK: usize = 64 * 1024;
const TAG: usize = 16;
const SEALED_CHUNK: u64 = (CHUNK + TAG) as u64;
pub(crate) const NONCE_PREFIX_LEN: usize = 16;

fn nonce(prefix: &[u8; NONCE_PREFIX_LEN], index: u64) -> XNonce {
    let mut bytes = [0u8; 24];
    bytes[..NONCE_PREFIX_LEN].copy_from_slice(prefix);
    bytes[NONCE_PREFIX_LEN..].copy_from_slice(&index.to_le_bytes());
    *XNonce::from_slice(&bytes)
}

fn aad(header: &[u8], last: bool) -> Vec<u8> {
    [header, &[last as u8]].concat()
}

/// Encrypts what is written to it, chunk by chunk, into `inner`.
/// [`SealWriter::finish`] writes the last chunk — without it the file does not open.
pub(crate) struct SealWriter<W: Write> {
    inner: W,
    cipher: XChaCha20Poly1305,
    prefix: [u8; NONCE_PREFIX_LEN],
    header: Vec<u8>,
    buffer: Zeroizing<Vec<u8>>,
    index: u64,
}

impl<W: Write> SealWriter<W> {
    pub(crate) fn new(inner: W, key: &Key, prefix: [u8; NONCE_PREFIX_LEN], header: Vec<u8>) -> Self {
        SealWriter {
            inner,
            cipher: XChaCha20Poly1305::new(key.as_ref().into()),
            prefix,
            header,
            buffer: Zeroizing::new(Vec::with_capacity(CHUNK)),
            index: 0,
        }
    }

    fn emit(&mut self, last: bool) -> io::Result<()> {
        let sealed = self
            .cipher
            .encrypt(&nonce(&self.prefix, self.index), Payload { msg: &self.buffer, aad: &aad(&self.header, last) })
            .map_err(|_| io::Error::other("encryption failed"))?;
        self.inner.write_all(&sealed)?;
        self.buffer.clear();
        self.index += 1;
        Ok(())
    }

    /// Seals what is left as the last chunk and returns the inner writer.
    pub(crate) fn finish(mut self) -> io::Result<W> {
        self.emit(true)?;
        self.inner.flush()?;
        Ok(self.inner)
    }
}

impl<W: Write> Write for SealWriter<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        // A full buffer is sealed only once more follows: the last chunk may be
        // a full one, but it is always the one `finish` seals.
        if self.buffer.len() == CHUNK && !buf.is_empty() {
            self.emit(false)?;
        }
        let take = buf.len().min(CHUNK - self.buffer.len());
        self.buffer.extend_from_slice(&buf[..take]);
        Ok(take)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

/// Why a sealed body did not open.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum OpenFailure {
    /// The length cannot be one of a sealed body.
    Malformed,
    /// The first chunk does not open: the wrong key, or a damaged file.
    FirstChunk,
}

/// Reads and seeks the clear archive inside a sealed body. Only the chunk
/// being read is decrypted; a chunk that does not open is an error of the read.
pub(crate) struct OpenReader<R: Read + Seek> {
    inner: R,
    /// Where the body starts in `inner`.
    start: u64,
    chunks: u64,
    sealed_len: u64,
    plain_len: u64,
    cipher: XChaCha20Poly1305,
    prefix: [u8; NONCE_PREFIX_LEN],
    header: Vec<u8>,
    pos: u64,
    cached: Option<(u64, Zeroizing<Vec<u8>>)>,
}

impl<R: Read + Seek> OpenReader<R> {
    /// The body runs from `start` to the end of `inner`. Opens the first chunk
    /// right away, so that a wrong key shows here and not as damage further in.
    pub(crate) fn new(
        mut inner: R,
        start: u64,
        key: &Key,
        prefix: [u8; NONCE_PREFIX_LEN],
        header: Vec<u8>,
    ) -> Result<Self, OpenFailure> {
        let end = inner.seek(SeekFrom::End(0)).map_err(|_| OpenFailure::Malformed)?;
        let sealed_len = end.checked_sub(start).ok_or(OpenFailure::Malformed)?;
        if sealed_len < TAG as u64 {
            return Err(OpenFailure::Malformed);
        }
        let chunks = sealed_len.div_ceil(SEALED_CHUNK);
        let last_len = sealed_len - (chunks - 1) * SEALED_CHUNK;
        if last_len < TAG as u64 {
            return Err(OpenFailure::Malformed);
        }
        let mut reader = OpenReader {
            inner,
            start,
            chunks,
            sealed_len,
            plain_len: sealed_len - chunks * TAG as u64,
            cipher: XChaCha20Poly1305::new(key.as_ref().into()),
            prefix,
            header,
            pos: 0,
            cached: None,
        };
        reader.load(0).map_err(|_| OpenFailure::FirstChunk)?;
        Ok(reader)
    }

    fn load(&mut self, index: u64) -> io::Result<()> {
        if self.cached.as_ref().is_some_and(|(i, _)| *i == index) {
            return Ok(());
        }
        let at = index * SEALED_CHUNK;
        let len = SEALED_CHUNK.min(self.sealed_len - at) as usize;
        let mut sealed = vec![0u8; len];
        self.inner.seek(SeekFrom::Start(self.start + at))?;
        self.inner.read_exact(&mut sealed)?;
        let last = index + 1 == self.chunks;
        let plain = self
            .cipher
            .decrypt(&nonce(&self.prefix, index), Payload { msg: &sealed, aad: &aad(&self.header, last) })
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "damaged chunk"))?;
        self.cached = Some((index, Zeroizing::new(plain)));
        Ok(())
    }
}

impl<R: Read + Seek> Read for OpenReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.pos >= self.plain_len || buf.is_empty() {
            return Ok(0);
        }
        let index = self.pos / CHUNK as u64;
        self.load(index)?;
        let (_, plain) = self.cached.as_ref().expect("loaded");
        let offset = (self.pos - index * CHUNK as u64) as usize;
        let n = buf.len().min(plain.len() - offset);
        buf[..n].copy_from_slice(&plain[offset..offset + n]);
        self.pos += n as u64;
        Ok(n)
    }
}

impl<R: Read + Seek> Seek for OpenReader<R> {
    fn seek(&mut self, to: SeekFrom) -> io::Result<u64> {
        let target = match to {
            SeekFrom::Start(n) => Some(n),
            SeekFrom::End(d) => self.plain_len.checked_add_signed(d),
            SeekFrom::Current(d) => self.pos.checked_add_signed(d),
        };
        self.pos = target.ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "seek before start"))?;
        Ok(self.pos)
    }
}

/// A plain body: `inner` from `start` on, as a file of its own.
pub(crate) struct Window<R: Read + Seek> {
    inner: R,
    start: u64,
}

impl<R: Read + Seek> Window<R> {
    pub(crate) fn new(mut inner: R, start: u64) -> io::Result<Self> {
        inner.seek(SeekFrom::Start(start))?;
        Ok(Window { inner, start })
    }
}

impl<R: Read + Seek> Read for Window<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.inner.read(buf)
    }
}

impl<R: Read + Seek> Seek for Window<R> {
    fn seek(&mut self, to: SeekFrom) -> io::Result<u64> {
        let absolute = match to {
            SeekFrom::Start(n) => self.inner.seek(SeekFrom::Start(self.start.saturating_add(n)))?,
            other => self.inner.seek(other)?,
        };
        absolute
            .checked_sub(self.start)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "seek before start"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn key() -> Key {
        Zeroizing::new([7u8; 32])
    }

    fn sealed(plain: &[u8]) -> Vec<u8> {
        let mut writer = SealWriter::new(Vec::new(), &key(), [1; NONCE_PREFIX_LEN], b"head".to_vec());
        // Odd write sizes, across chunk borders.
        for part in plain.chunks(7001) {
            writer.write_all(part).unwrap();
        }
        writer.finish().unwrap()
    }

    fn open(bytes: Vec<u8>) -> Result<OpenReader<Cursor<Vec<u8>>>, OpenFailure> {
        OpenReader::new(Cursor::new(bytes), 0, &key(), [1; NONCE_PREFIX_LEN], b"head".to_vec())
    }

    fn sample(len: usize) -> Vec<u8> {
        (0..len).map(|i| (i * 31 % 251) as u8).collect()
    }

    #[test]
    fn round_trips_at_every_size_around_a_chunk() {
        for len in [0, 1, CHUNK - 1, CHUNK, CHUNK + 1, 3 * CHUNK, 3 * CHUNK + 5] {
            let plain = sample(len);
            let mut out = Vec::new();
            open(sealed(&plain)).unwrap().read_to_end(&mut out).unwrap();
            assert_eq!(out, plain, "length {len}");
        }
    }

    #[test]
    fn seeks_anywhere() {
        let plain = sample(3 * CHUNK + 100);
        let mut reader = open(sealed(&plain)).unwrap();
        for at in [CHUNK as u64 * 2 + 3, 5, CHUNK as u64 - 2, plain.len() as u64 - 10] {
            reader.seek(SeekFrom::Start(at)).unwrap();
            let mut buf = [0u8; 10];
            reader.read_exact(&mut buf).unwrap();
            assert_eq!(&buf[..], &plain[at as usize..at as usize + 10]);
        }
        assert_eq!(reader.seek(SeekFrom::End(0)).unwrap(), plain.len() as u64);
    }

    #[test]
    fn a_wrong_key_fails_at_the_first_chunk() {
        let bytes = sealed(&sample(100));
        let other = Zeroizing::new([8u8; 32]);
        let result = OpenReader::new(Cursor::new(bytes), 0, &other, [1; NONCE_PREFIX_LEN], b"head".to_vec());
        assert_eq!(result.err(), Some(OpenFailure::FirstChunk));
    }

    #[test]
    fn a_changed_header_fails() {
        let bytes = sealed(&sample(100));
        let result = OpenReader::new(Cursor::new(bytes), 0, &key(), [1; NONCE_PREFIX_LEN], b"Head".to_vec());
        assert_eq!(result.err(), Some(OpenFailure::FirstChunk));
    }

    #[test]
    fn a_file_cut_at_a_chunk_border_fails() {
        let bytes = sealed(&sample(3 * CHUNK + 100));
        let cut = bytes[..2 * SEALED_CHUNK as usize].to_vec();
        let mut reader = open(cut).unwrap();
        let mut out = Vec::new();
        assert!(reader.read_to_end(&mut out).is_err());
    }

    #[test]
    fn a_damaged_or_swapped_chunk_fails() {
        let mut bytes = sealed(&sample(3 * CHUNK));
        bytes[SEALED_CHUNK as usize + 9] ^= 1;
        let mut out = Vec::new();
        assert!(open(bytes).unwrap().read_to_end(&mut out).is_err());

        let bytes = sealed(&sample(3 * CHUNK + 1));
        let c = SEALED_CHUNK as usize;
        let mut swapped = bytes.clone();
        swapped[c..2 * c].copy_from_slice(&bytes[2 * c..3 * c]);
        swapped[2 * c..3 * c].copy_from_slice(&bytes[c..2 * c]);
        let mut out = Vec::new();
        assert!(open(swapped).unwrap().read_to_end(&mut out).is_err());
    }

    #[test]
    fn impossible_lengths_are_refused() {
        assert_eq!(open(vec![0u8; 5]).err(), Some(OpenFailure::Malformed));
        assert_eq!(open(vec![0u8; SEALED_CHUNK as usize + 3]).err(), Some(OpenFailure::Malformed));
    }

    #[test]
    fn a_window_hides_what_comes_before() {
        let bytes = [b"prefix".as_slice(), b"body!"].concat();
        let mut window = Window::new(Cursor::new(bytes), 6).unwrap();
        let mut out = String::new();
        window.read_to_string(&mut out).unwrap();
        assert_eq!(out, "body!");
        assert_eq!(window.seek(SeekFrom::End(0)).unwrap(), 5);
        assert_eq!(window.seek(SeekFrom::Start(1)).unwrap(), 1);
    }
}

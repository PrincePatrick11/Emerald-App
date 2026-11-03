import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { Music, Pause, Play } from 'lucide-react';
import { formatDuration } from '../../lib/media';
import { invoke } from '@tauri-apps/api/core';

// Module-level cache: file path → blob URL. A sound file is read from disk
// once per session; a blob URL (unlike a data URL) lets the player seek
// without holding a second copy of a long base64 string.
const audioUrlCache = new Map<string, string>();
const audioInflight = new Map<string, Promise<string>>();

function loadAudio(path: string): Promise<string> {
  const cached = audioUrlCache.get(path);
  if (cached) return Promise.resolve(cached);
  const inflight = audioInflight.get(path);
  if (inflight) return inflight;

  const promise = invoke<string>('read_audio_as_base64', { path })
    .then(async (dataUrl) => {
      const blob = await (await fetch(dataUrl)).blob();
      const url = URL.createObjectURL(blob);
      audioUrlCache.set(path, url);
      return url;
    })
    .catch((e) => {
      console.error('Failed to load audio:', path, e);
      return '';
    })
    .finally(() => audioInflight.delete(path));

  audioInflight.set(path, promise);
  return promise;
}

function AudioView({ node, selected }: NodeViewProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const rawSrc = node.attrs.src as string;
  const title = (node.attrs.title as string | null) || rawSrc?.split(/[\\/]/).pop() || 'Audio';
  const [url, setUrl] = useState(() => (rawSrc?.startsWith('data:') ? rawSrc : audioUrlCache.get(rawSrc) ?? ''));
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!rawSrc || rawSrc.startsWith('data:')) return;
    let cancelled = false;
    loadAudio(rawSrc).then((u) => {
      if (cancelled) return;
      if (u) setUrl(u); else setFailed(true);
    });
    return () => { cancelled = true; };
  }, [rawSrc]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el || !url) return;
    if (el.paused) el.play().catch(() => setFailed(true)); else el.pause();
  };

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    el.currentTime = Number(e.target.value);
    setCurrent(el.currentTime);
  };

  const progress = duration ? (current / duration) * 100 : 0;

  return (
    <NodeViewWrapper className="audio-node my-3" data-drag-handle="">
      <div
        className={`audio-player flex items-center gap-3 rounded-lg border px-3 py-2${selected ? ' ring-2 ring-jade-500' : ''}`}
        contentEditable={false}
      >
        <button
          type="button"
          onClick={toggle}
          disabled={!url}
          className="audio-player-btn flex items-center justify-center w-8 h-8 rounded-full shrink-0 transition-colors disabled:opacity-40"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause size={14} /> : <Play size={14} className="translate-x-px" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
            <Music size={11} className="shrink-0 opacity-70" />
            <span className="truncate">{title}</span>
            {failed && <span className="text-red-400 shrink-0">· !</span>}
          </div>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step="any"
            value={current}
            onChange={seek}
            disabled={!duration}
            className="audio-player-progress w-full"
            style={{ ['--audio-progress' as string]: `${progress}%` }}
            aria-label="Position"
          />
        </div>
        <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'var(--text-muted)' }}>
          {formatDuration(current)} / {formatDuration(duration)}
        </span>
        <audio
          ref={audioRef}
          src={url || undefined}
          preload="metadata"
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onDurationChange={(e) => setDuration(e.currentTarget.duration)}
          onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onError={() => setFailed(true)}
        />
      </div>
    </NodeViewWrapper>
  );
}

/**
 * An embedded sound file. Stored in the entry HTML as
 * `<audio src="<path in app-data/audio>" data-title="<file name>">`; shown
 * in the editor as a small player.
 */
export const Audio = Node.create({
  name: 'audio',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src:   { default: null },
      title: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'audio[src]',
        getAttrs: (el) => {
          const audio = el as HTMLAudioElement;
          return { src: audio.getAttribute('src'), title: audio.getAttribute('data-title') };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { title, ...rest } = HTMLAttributes;
    return ['audio', mergeAttributes(rest, { 'data-title': title ?? '', controls: 'true', preload: 'none' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AudioView);
  },
});

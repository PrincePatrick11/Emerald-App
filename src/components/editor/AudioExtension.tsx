import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Music, Pause, Play } from 'lucide-react';
import { audioTitle, dataUrlToBlob, formatDuration } from '../../lib/media';
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
    .then((dataUrl) => {
      // Decoded here rather than with fetch(dataUrl): the app CSP's
      // connect-src doesn't allow data: URLs, and Chromium enforces that.
      const url = URL.createObjectURL(dataUrlToBlob(dataUrl));
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

/** Narrowest the player gets while resizing — play button, a short bar and the time still fit. */
const MIN_WIDTH = 240;
/** Width of a newly inserted player, and of one saved before it could be resized. */
const DEFAULT_WIDTH = '360px';

function AudioView({ node, selected, updateAttributes, editor }: NodeViewProps) {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [resizing, setResizing] = useState(false);
  const showHandle = editor.isEditable && (selected || hovered || resizing);
  const rawSrc = node.attrs.src as string;
  const title = audioTitle(rawSrc, node.attrs.title as string | null);
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

  // Same resize behaviour as images (ResizableImageExtension): drag the
  // corner handle, the width is stored as a share of the editor's width.
  const onResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = playerRef.current?.getBoundingClientRect().width ?? parseInt(DEFAULT_WIDTH, 10);
    const editorW = playerRef.current?.closest('.ProseMirror')?.getBoundingClientRect().width ?? 600;
    setResizing(true);
    const onMove = (ev: PointerEvent) => {
      const w = Math.max(MIN_WIDTH, Math.min(editorW, startW + (ev.clientX - startX)));
      updateAttributes({ width: `${Math.round((w / editorW) * 100)}%` });
    };
    const onUp = () => {
      setResizing(false);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  return (
    <NodeViewWrapper
      className="audio-node my-3"
      data-drag-handle=""
      style={{ display: 'block', width: node.attrs.width ?? DEFAULT_WIDTH, minWidth: MIN_WIDTH, maxWidth: '100%' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        ref={playerRef}
        className={`audio-player relative flex items-center gap-3 rounded-lg border px-3 py-2${selected ? ' audio-player-selected' : ''}`}
        contentEditable={false}
      >
        <button
          type="button"
          onClick={toggle}
          disabled={!url}
          className="audio-player-btn flex items-center justify-center w-8 h-8 rounded-full shrink-0 transition-colors disabled:opacity-40"
          aria-label={playing ? t('editor.audio.pause') : t('editor.audio.play')}
          title={playing ? t('editor.audio.pause') : t('editor.audio.play')}
        >
          {playing ? <Pause size={14} /> : <Play size={14} className="translate-x-px" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
            <Music size={11} className="shrink-0 opacity-70" />
            <span className="truncate">{title}</span>
            {failed && <span className="audio-player-error shrink-0">· {t('editor.audio.loadFailed')}</span>}
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
            aria-label={t('editor.audio.position')}
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
        {showHandle && (
          <div
            className="absolute bottom-1.5 right-1.5 w-3.5 h-3.5 rounded-sm cursor-se-resize"
            style={{ touchAction: 'none', background: 'rgba(210,210,210,0.85)', border: '1px solid rgba(255,255,255,0.5)' }}
            onPointerDown={onResizeStart}
          />
        )}
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
      width: { default: DEFAULT_WIDTH },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'audio[src]',
        getAttrs: (el) => {
          const audio = el as HTMLAudioElement;
          return {
            src: audio.getAttribute('src'),
            title: audio.getAttribute('data-title'),
            width: audio.style.width || DEFAULT_WIDTH,
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { title, width, ...rest } = HTMLAttributes;
    return ['audio', mergeAttributes(rest, {
      'data-title': title ?? '', controls: 'true', preload: 'none', style: `width:${width ?? DEFAULT_WIDTH}`,
    })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AudioView);
  },
});

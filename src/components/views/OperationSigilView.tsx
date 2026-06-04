import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  Eraser,
  Image as ImageIcon,
  PanelRightOpen,
  Pencil,
  PenTool,
  Redo2,
  RotateCcw,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { format } from 'date-fns';
import { useUIStore } from '../../store/uiStore';
import { useOperationStore } from '../../store/operationStore';
import { useUndoStore } from '../../store/undoStore';
import { generateId } from '../../lib/helpers';
import type { Operation } from '../../types';

type DrawMode = 'draw' | 'erase';

const SIGIL_COLORS = ['#f8fafc', '#00e699', '#f59e0b', '#ef4444', '#60a5fa', '#a78bfa', '#111827'];

function extractUniqueLetters(input: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const char of input.normalize('NFKD').toUpperCase()) {
    if (!/\p{L}/u.test(char)) continue;
    if (seen.has(char)) continue;
    seen.add(char);
    result.push(char);
  }
  return result;
}

function DrawingCanvas({
  initialData,
  mode,
  brushColor,
  brushSize,
  clearVersion,
  editable,
  onChange,
}: {
  initialData: string | null;
  mode: DrawMode;
  brushColor: string;
  brushSize: number;
  clearVersion: number;
  editable: boolean;
  onChange: (dataUrl: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const lastLoadedRef = useRef<string | null | undefined>(undefined);
  const lastClearVersionRef = useRef(clearVersion);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const loadImage = useCallback((dataUrl: string | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!dataUrl) return;
    const img = new window.Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = dataUrl;
  }, []);

  useEffect(() => {
    if (lastLoadedRef.current === initialData) return;
    lastLoadedRef.current = initialData;
    loadImage(initialData);
  }, [initialData, loadImage]);

  useEffect(() => {
    if (lastClearVersionRef.current === clearVersion) return;
    lastClearVersionRef.current = clearVersion;
    clearCanvas();
    lastLoadedRef.current = null;
    onChange(null);
  }, [clearVersion, clearCanvas, onChange]);

  const getPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * canvas.width) / rect.width,
      y: ((event.clientY - rect.top) * canvas.height) / rect.height,
    };
  };

  const commitSnapshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    lastLoadedRef.current = dataUrl;
    onChange(dataUrl);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!editable) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const point = getPoint(event);
    isDrawingRef.current = true;
    lastPointRef.current = point;
    canvas.setPointerCapture(event.pointerId);
    ctx.beginPath();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = brushSize;
    ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!editable || !isDrawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const point = getPoint(event);
    const previous = lastPointRef.current ?? point;
    ctx.beginPath();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = brushSize;
    ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
    ctx.moveTo(previous.x, previous.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPointRef.current = point;
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!editable) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (isDrawingRef.current) commitSnapshot();
    isDrawingRef.current = false;
    lastPointRef.current = null;
  };

  return (
    <div className="sigil-canvas-shell relative overflow-hidden rounded-xl border border-stone-700/50 bg-stone-950/80">
      <canvas
        ref={canvasRef}
        width={1200}
        height={800}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className={`sigil-canvas relative block aspect-[3/2] w-full touch-none bg-transparent ${editable ? 'cursor-crosshair' : 'cursor-default'}`}
      />
    </div>
  );
}

export default function OperationSigilView({ operation }: { operation: Operation }) {
  const { t } = useTranslation();
  const setActiveView = useUIStore((s) => s.setActiveView);
  const toggleRightSidebar = useUIStore((s) => s.toggleRightSidebar);
  const updateOperation = useOperationStore((s) => s.updateOperation);
  const deleteOperation = useOperationStore((s) => s.deleteOperation);
  const restoreOperation = useOperationStore((s) => s.restoreOperation);
  const categories = useOperationStore((s) => s.categories);
  const pushUndo = useUndoStore((s) => s.push);

  const isEditing = useUIStore((s) => s.activeView.mode === 'edit');
  const currentCategory = categories.find((cat) => cat.id === operation.category_id);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetRevealDate, setTargetRevealDate] = useState('');
  const [intentionText, setIntentionText] = useState('');
  const [letterBank, setLetterBank] = useState<string[]>([]);
  const [implementedLetters, setImplementedLetters] = useState<string[]>([]);
  const [manualLetterText, setManualLetterText] = useState('');
  const [drawingData, setDrawingData] = useState<string | null>(null);
  const [brushColor, setBrushColor] = useState(SIGIL_COLORS[0]);
  const [brushSize, setBrushSize] = useState(8);
  const [drawMode, setDrawMode] = useState<DrawMode>('draw');
  const [clearVersion, setClearVersion] = useState(0);
  const [drawingHistory, setDrawingHistory] = useState<(string | null)[]>([null]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [loadDelayInput, setLoadDelayInput] = useState('0');
  const [loadCountdown, setLoadCountdown] = useState<number | null>(null);

  const drawingHistoryRef = useRef(drawingHistory);
  drawingHistoryRef.current = drawingHistory;
  const historyIndexRef = useRef(historyIndex);
  historyIndexRef.current = historyIndex;

  const pendingRef = useRef({
    title,
    description,
    target_reveal_date: targetRevealDate || null,
    intention_text: intentionText,
    letter_bank: letterBank,
    implemented_letters: implementedLetters,
    drawing_data: drawingData,
    thumbnail_data: drawingData,
  });
  pendingRef.current = {
    title,
    description,
    target_reveal_date: targetRevealDate || null,
    intention_text: intentionText,
    letter_bank: letterBank,
    implemented_letters: implementedLetters,
    drawing_data: drawingData,
    thumbnail_data: drawingData,
  };

  const isEditingRef = useRef(false);
  isEditingRef.current = isEditing;
  const operationIdRef = useRef<string | undefined>(undefined);
  operationIdRef.current = operation.id;

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerAutoSave = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      if (!isEditingRef.current) return;
      const id = operationIdRef.current;
      if (id) updateOperation(id, pendingRef.current);
    }, 1000);
  }, [updateOperation]);

  useEffect(() => {
    setTitle(operation.title);
    setDescription(operation.description ?? '');
    setTargetRevealDate(operation.target_reveal_date ?? '');
    setIntentionText(operation.intention_text ?? '');
    setLetterBank(operation.letter_bank ?? []);
    setImplementedLetters(operation.implemented_letters ?? []);
    const nextDrawing = operation.drawing_data ?? null;
    setDrawingData(nextDrawing);
    setDrawingHistory(nextDrawing ? [null, nextDrawing] : [null]);
    setHistoryIndex(nextDrawing ? 1 : 0);
    setLoadCountdown(null);
  }, [operation.id]);

  // Sync text/letter fields when the store updates from outside (e.g. sidebar edits in view mode).
  // Drawing data is intentionally excluded: it is handled by the id-change effect above,
  // and the canvas manages its own load via the DrawingCanvas useEffect on initialData.
  useEffect(() => {
    setTitle(operation.title);
    setDescription(operation.description ?? '');
    setTargetRevealDate(operation.target_reveal_date ?? '');
    setIntentionText(operation.intention_text ?? '');
    setLetterBank(operation.letter_bank ?? []);
    setImplementedLetters(operation.implemented_letters ?? []);
  }, [
    operation.title,
    operation.description,
    operation.target_reveal_date,
    operation.intention_text,
    operation.letter_bank,
    operation.implemented_letters,
  ]);

  useEffect(() => {
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, []);

  const isAutoHiddenSigil = useMemo(() => (
    operation.is_loaded
    && !!operation.target_reveal_date
    && operation.show_sigil === false
    && operation.show_intention_in_properties === false
    && operation.show_letter_bank_in_properties === false
  ), [
    operation.is_loaded,
    operation.target_reveal_date,
    operation.show_sigil,
    operation.show_intention_in_properties,
    operation.show_letter_bank_in_properties,
  ]);

  useEffect(() => {
    if (!isAutoHiddenSigil || !operation.target_reveal_date) return;
    const today = new Date().toISOString().slice(0, 10);
    if (operation.target_reveal_date <= today) {
      updateOperation(operation.id, {
        show_sigil: true,
        show_intention_in_properties: true,
        show_letter_bank_in_properties: true,
      }).catch(console.error);
    }
  }, [isAutoHiddenSigil, operation.id, operation.target_reveal_date, updateOperation]);

  const sigilVisible = operation.show_sigil !== false;

  const handleDone = async () => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    await updateOperation(operation.id, pendingRef.current);
    setActiveView({ type: 'operations', id: operation.id, mode: 'view' });
  };

  const handleCancel = () => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    setTitle(operation.title);
    setDescription(operation.description ?? '');
    setTargetRevealDate(operation.target_reveal_date ?? '');
    setIntentionText(operation.intention_text ?? '');
    setLetterBank(operation.letter_bank ?? []);
    setImplementedLetters(operation.implemented_letters ?? []);
    const nextDrawing = operation.drawing_data ?? null;
    setDrawingData(nextDrawing);
    setDrawingHistory(nextDrawing ? [null, nextDrawing] : [null]);
    setHistoryIndex(nextDrawing ? 1 : 0);
    setActiveView({ type: 'operations', id: operation.id, mode: 'view' });
  };

  const handleDelete = async () => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    const id = operation.id;
    await deleteOperation(id);
    pushUndo({ id: generateId(), description: t('undo.operationDeleted'), undo: () => restoreOperation(id) });
    setActiveView({ type: 'operations' });
  };

  const enterEditMode = () => {
    if (isEditing || operation.is_loaded) return;
    setActiveView({ type: 'operations', id: operation.id, mode: 'edit' });
  };

  const handleCanvasChange = useCallback((dataUrl: string | null) => {
    const currentHistory = drawingHistoryRef.current;
    const currentIndex = historyIndexRef.current;
    const trimmed = currentHistory.slice(0, currentIndex + 1);
    const isDuplicate = trimmed[trimmed.length - 1] === dataUrl;
    setDrawingData(dataUrl);
    setDrawingHistory(isDuplicate ? trimmed : [...trimmed, dataUrl]);
    setHistoryIndex(isDuplicate ? currentIndex : currentIndex + 1);
    triggerAutoSave();
  }, [triggerAutoSave]);

  const handleUndoStroke = () => {
    const nextIndex = historyIndexRef.current - 1;
    if (nextIndex < 0) return;
    setHistoryIndex(nextIndex);
    setDrawingData(drawingHistoryRef.current[nextIndex] ?? null);
    triggerAutoSave();
  };

  const handleRedoStroke = () => {
    const nextIndex = historyIndexRef.current + 1;
    if (nextIndex >= drawingHistoryRef.current.length) return;
    setHistoryIndex(nextIndex);
    setDrawingData(drawingHistoryRef.current[nextIndex] ?? null);
    triggerAutoSave();
  };

  const completeSigilLoad = useCallback(async () => {
    if (!operation.target_reveal_date) return;
    await updateOperation(operation.id, {
      is_loaded: true,
      show_sigil: false,
      show_intention_in_properties: false,
      show_letter_bank_in_properties: false,
    });
  }, [operation.id, operation.target_reveal_date, updateOperation]);

  const handleSigilLoaded = async () => {
    const seconds = Math.max(0, Number.parseInt(loadDelayInput || '0', 10) || 0);
    if (seconds > 0) {
      setLoadCountdown(seconds);
      return;
    }
    await completeSigilLoad();
  };

  const handleHideSigil = async () => {
    await updateOperation(operation.id, { show_sigil: false });
  };

  const handleShowSigil = async () => {
    await updateOperation(operation.id, { show_sigil: true });
  };

  useEffect(() => {
    if (loadCountdown == null) return;
    if (loadCountdown <= 0) {
      setLoadCountdown(null);
      completeSigilLoad().catch(console.error);
      return;
    }
    const timer = window.setTimeout(() => setLoadCountdown((value) => (value == null ? null : value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [loadCountdown, completeSigilLoad]);

  const handlePrepareLetters = () => {
    const uniqueLetters = extractUniqueLetters(intentionText);
    setLetterBank(uniqueLetters);
    setImplementedLetters((prev) => prev.filter((letter) => uniqueLetters.includes(letter)));
    triggerAutoSave();
  };

  const handlePrepareManualLetters = () => {
    const nextLetters = extractUniqueLetters(manualLetterText);
    if (nextLetters.length === 0) {
      setManualLetterText('');
      return;
    }
    setLetterBank(nextLetters);
    setImplementedLetters((prev) => prev.filter((letter) => nextLetters.includes(letter)));
    setManualLetterText('');
    triggerAutoSave();
  };

  const toggleImplementedLetter = (letter: string) => {
    setImplementedLetters((prev) => (prev.includes(letter) ? prev.filter((item) => item !== letter) : [...prev, letter]));
    triggerAutoSave();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 flex-shrink-0 items-center justify-between border-b border-stone-700/60 px-6">
        <div className="flex items-center gap-2 text-xs text-stone-600">
          <button onClick={() => setActiveView({ type: 'operations' })} className="text-stone-500 transition-colors hover:text-stone-300">
            {t('nav.operations')}
          </button>
          {currentCategory?.emoji && <span>{currentCategory.emoji}</span>}
          <span>{currentCategory?.is_builtin ? t(`operations.categories.${currentCategory.id}`) : currentCategory?.name ?? '—'}</span>
          <span>·</span>
          <span>{format(new Date(operation.updated_at), 'MMM d, yyyy')}</span>
          {isEditing && <span className="ml-1 italic text-stone-700">{t('editor.editing')}</span>}
        </div>
        <div className="flex items-center gap-1">
          {isEditing ? (
            <>
              <button onClick={handleDone} className="flex items-center gap-1.5 rounded-md border border-jade-800/40 bg-jade-900/40 px-3 py-1.5 text-xs font-medium text-jade-400 transition-colors hover:bg-jade-900/60">
                <Check size={13} />
                {t('editor.done')}
              </button>
              <button onClick={handleDelete} className="btn-ghost text-red-600 hover:text-red-400" title={t('editor.delete')}>
                <Trash2 size={15} />
              </button>
              <button onClick={handleCancel} className="btn-ghost">
                <X size={15} />
              </button>
            </>
          ) : (
            <>
              {!operation.is_loaded && (
                <button onClick={enterEditMode} className="btn-ghost" title={t('editor.edit')}>
                  <Pencil size={15} />
                </button>
              )}
              {operation.is_loaded && (
                <button
                  onClick={sigilVisible ? handleHideSigil : handleShowSigil}
                  className="btn-ghost text-xs"
                >
                  {sigilVisible ? t('creation.hideSigil') : t('creation.showSigil')}
                </button>
              )}
              <button onClick={toggleRightSidebar} className="btn-ghost">
                <PanelRightOpen size={15} />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 px-8 pb-4 pt-8" onDoubleClick={enterEditMode}>
        {isEditing ? (
          <input
            autoFocus
            type="text"
            value={title}
            onChange={(event) => { setTitle(event.target.value); triggerAutoSave(); }}
            placeholder={t('operations.untitled')}
            className="entry-view-title w-full bg-transparent text-2xl font-semibold text-stone-100 outline-none placeholder-stone-700 selectable"
          />
        ) : (
          <h1 className="entry-view-title cursor-text text-2xl font-semibold text-stone-100" title={t('editor.doubleClickEdit')}>
            {operation.title || t('operations.untitled')}
          </h1>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <div className="mx-auto max-w-6xl space-y-5">
          {isEditing && (
            <div className="panel space-y-5 p-5">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <p className="label-xs">{t('creation.intention')}</p>
                  <textarea
                    value={intentionText}
                    onChange={(event) => { setIntentionText(event.target.value); triggerAutoSave(); }}
                    placeholder={t('creation.intentionPlaceholder')}
                    className="entry-view-body min-h-28 w-full rounded-xl border border-stone-700/50 bg-stone-900/70 px-3 py-2 text-sm text-stone-300 outline-none placeholder-stone-600 resize-y selectable"
                  />
                </div>

                <div className="space-y-2">
                  <p className="label-xs">{t('creation.shortenSigil')}</p>
                  <textarea
                    value={manualLetterText}
                    onChange={(event) => setManualLetterText(event.target.value.toUpperCase())}
                    placeholder={t('creation.manualLetterPlaceholder')}
                    className="min-h-28 w-full rounded-xl border border-stone-700/50 bg-stone-900/70 px-3 py-2 text-sm text-stone-300 outline-none placeholder-stone-600 resize-y selectable"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button onClick={handlePrepareManualLetters} className="btn-secondary">
                  {t('creation.addLetter')}
                </button>
                <button onClick={handlePrepareLetters} className="btn-primary">
                  {t('creation.prepareLetters')}
                </button>
              </div>

              <div className="space-y-3">
                <p className="label-xs">{t('creation.letterBank')}</p>
                {letterBank.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {letterBank.map((letter) => {
                      const implemented = implementedLetters.includes(letter);
                      return (
                        <button
                          key={letter}
                          onClick={() => toggleImplementedLetter(letter)}
                          className={`h-10 w-10 rounded-md border text-sm font-semibold transition-colors ${
                            implemented
                              ? 'border-jade-800/40 bg-jade-900/30 text-jade-400'
                              : 'border-stone-700/50 bg-stone-800/70 text-stone-300 hover:border-stone-600'
                          }`}
                        >
                          {letter}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-stone-600">{t('creation.noLetters')}</p>
                )}
              </div>
            </div>
          )}

          <div className="panel p-5">
            {!isEditing && isAutoHiddenSigil && operation.target_reveal_date && (
              <p className="mb-3 text-sm text-stone-500">
                {t('creation.hiddenUntilDate', { date: operation.target_reveal_date })}
              </p>
            )}

            <div className="rounded-xl border border-stone-700/40 bg-stone-900/35 p-3">
              {isEditing || sigilVisible ? (
                <DrawingCanvas
                  initialData={drawingData}
                  mode={drawMode}
                  brushColor={brushColor}
                  brushSize={brushSize}
                  clearVersion={clearVersion}
                  editable={isEditing}
                  onChange={handleCanvasChange}
                />
              ) : (
                <div className="flex aspect-[3/2] items-center justify-center rounded-xl border border-stone-700/50 bg-stone-900/70 p-6">
                  <ImageIcon size={34} className="text-stone-700" />
                </div>
              )}
            </div>

            {!isEditing && !operation.is_loaded && (
              <div className="mt-4 flex flex-wrap gap-2">
                <div className="flex items-center gap-2 rounded-md border border-stone-700/40 bg-stone-800/40 px-3 py-1.5">
                  <span className="text-xs text-stone-500">{t('creation.timerLabel')}</span>
                  <input
                    type="number"
                    min="0"
                    value={loadDelayInput}
                    onChange={(event) => setLoadDelayInput(event.target.value)}
                    className="w-16 bg-transparent text-xs text-stone-300 outline-none"
                    placeholder={t('creation.timerSeconds')}
                  />
                </div>
                <button
                  onClick={handleSigilLoaded}
                  disabled={!operation.target_reveal_date}
                  className="btn-secondary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loadCountdown != null ? `${loadCountdown}s` : t('creation.loadSigille')}
                </button>
              </div>
            )}

            {isEditing && (
              <>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <div className="sigil-tool-toggle flex items-center gap-1 rounded-lg border border-stone-700/40 bg-stone-800/70 p-1">
                    <button
                      onClick={() => setDrawMode('draw')}
                      className={`sigil-tool-btn flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${
                        drawMode === 'draw' ? 'bg-stone-700 text-stone-100' : 'text-stone-400 hover:text-stone-200'
                      }`}
                    >
                      <PenTool size={13} />
                      {t('creation.tools.draw')}
                    </button>
                    <button
                      onClick={() => setDrawMode('erase')}
                      className={`sigil-tool-btn flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${
                        drawMode === 'erase' ? 'bg-stone-700 text-stone-100' : 'text-stone-400 hover:text-stone-200'
                      }`}
                    >
                      <Eraser size={13} />
                      {t('creation.tools.erase')}
                    </button>
                  </div>
                  <div className="sigil-brush-controls flex items-center gap-2 text-xs text-stone-400">
                    <span>{t('creation.brushSize')}</span>
                    <input
                      type="range"
                      min={2}
                      max={48}
                      value={brushSize}
                      onChange={(event) => setBrushSize(Number(event.target.value))}
                      className="sigil-brush-slider accent-jade-400"
                    />
                    <span className="w-7 text-right text-stone-500">{brushSize}</span>
                  </div>
                  <button onClick={handleUndoStroke} disabled={historyIndex <= 0} className="btn-ghost text-xs disabled:cursor-not-allowed disabled:opacity-40">
                    <Undo2 size={13} />
                    {t('creation.undo')}
                  </button>
                  <button onClick={handleRedoStroke} disabled={historyIndex >= drawingHistory.length - 1} className="btn-ghost text-xs disabled:cursor-not-allowed disabled:opacity-40">
                    <Redo2 size={13} />
                    {t('creation.redo')}
                  </button>
                  <button onClick={() => setClearVersion((value) => value + 1)} className="btn-ghost text-xs">
                    <RotateCcw size={13} />
                    {t('creation.clear')}
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {SIGIL_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setBrushColor(color)}
                      className={`h-8 w-8 rounded-full border-2 transition-transform ${
                        brushColor === color ? 'scale-105 border-stone-200' : 'border-stone-700 hover:border-stone-500'
                      }`}
                      style={{ backgroundColor: color }}
                      aria-label={color}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

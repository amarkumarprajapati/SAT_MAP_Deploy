'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Clapperboard, FileText, MapPin, Upload, X } from 'lucide-react';
import { api } from '@/config/api';
import type { GeoVideoFrame } from '@/lib/geospatial-video';

interface Props {
  onClose: () => void;
  onFramesChange: (frames: GeoVideoFrame[] | null) => void;
  onFrameChange: (frame: GeoVideoFrame | null) => void;
}

export default function GeospatialVideoPanel({ onClose, onFramesChange, onFrameChange }: Props) {
  const videoInputRef = useRef<HTMLInputElement>(null);
  const metadataInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoUrlRef = useRef<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [frames, setFrames] = useState<GeoVideoFrame[]>([]);
  const [currentFrame, setCurrentFrame] = useState<GeoVideoFrame | null>(null);
  const [metadataName, setMetadataName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => () => {
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
  }, []);

  const selectVideo = (file?: File) => {
    if (!file) return;
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    videoUrlRef.current = URL.createObjectURL(file);
    setVideoFile(file);
    setVideoUrl(videoUrlRef.current);
  };

  useEffect(() => {
    onFramesChange(frames.length ? frames : null);
  }, [frames, onFramesChange]);

  useEffect(() => {
    onFrameChange(currentFrame);
  }, [currentFrame, onFrameChange]);

  const updateFrame = () => {
    const video = videoRef.current;
    if (!video || frames.length === 0) return;
    const time = video.currentTime;
    let low = 0;
    let high = frames.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      if (frames[mid].timeSeconds <= time) low = mid;
      else high = mid - 1;
    }
    setCurrentFrame(frames[low]);
  };

  const frameTime = useMemo(() => currentFrame ? `${currentFrame.timeSeconds.toFixed(2)}s` : '—', [currentFrame]);

  const loadMetadata = async (file: File) => {
    setError('');
    setLoading(true);
    setMetadataName(file.name);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch(api.geospatialVideoMetadata(), { method: 'POST', body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || `Metadata import failed (${response.status})`);
      const parsed = Array.isArray(result.frames) ? result.frames as GeoVideoFrame[] : [];
      if (!parsed.length) throw new Error('The metadata file contains no usable position frames.');
      setFrames(parsed);
      setCurrentFrame(parsed[0]);
    } catch (cause) {
      setFrames([]);
      setCurrentFrame(null);
      setError(cause instanceof Error ? cause.message : 'Could not read this metadata file.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="pointer-events-auto fixed bottom-4 right-4 z-[240] flex max-h-[min(72vh,650px)] w-[min(560px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-cyan-300/25 bg-[#09111bf2] text-zinc-100 shadow-[0_18px_60px_rgba(0,0,0,.72),0_0_30px_rgba(0,229,255,.08)] backdrop-blur-2xl" aria-label="Geospatial video player">
      <header className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-300/[0.08] text-cyan-300"><Clapperboard size={16}/></span>
          <div className="min-w-0"><h2 className="font-mono text-[10px] font-bold tracking-[0.15em] text-white">GEOSPATIAL VIDEO</h2><p className="mt-0.5 truncate font-mono text-[9px] text-zinc-500">Video playback · synchronized map position</p></div>
        </div>
        <button onClick={onClose} aria-label="Close geospatial video" className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/[0.08] hover:text-white"><X size={16}/></button>
      </header>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3">
        <div className="overflow-hidden rounded-xl border border-white/[0.09] bg-black">
          {videoUrl ? <video ref={videoRef} src={videoUrl} controls playsInline onTimeUpdate={updateFrame} onSeeked={updateFrame} onLoadedMetadata={updateFrame} className="block max-h-[min(40vh,360px)] w-full bg-black object-contain" /> : <button type="button" onClick={() => videoInputRef.current?.click()} className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-[radial-gradient(ellipse_at_center,rgba(14,116,144,.13),transparent_65%)] text-zinc-400 transition hover:text-cyan-200"><Clapperboard size={25} className="text-cyan-300/70"/><span className="font-mono text-[10px] font-bold tracking-[0.12em]">SELECT GEOSPATIAL VIDEO</span><span className="text-[9px] text-zinc-600">MP4, MOV, WebM or browser-supported format</span></button>}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => videoInputRef.current?.click()} className="flex min-w-0 items-center gap-2 rounded-lg border border-white/[0.09] bg-white/[0.035] px-3 py-2 text-left transition hover:border-cyan-300/25 hover:bg-cyan-300/[0.05]"><Upload size={14} className="shrink-0 text-cyan-300"/><span className="min-w-0"><span className="block font-mono text-[9px] font-semibold tracking-wide text-zinc-200">VIDEO FILE</span><span className="block truncate text-[9px] text-zinc-500">{videoFile?.name ?? 'Choose a video'}</span></span></button>
          <button type="button" disabled={loading} onClick={() => metadataInputRef.current?.click()} className="flex min-w-0 items-center gap-2 rounded-lg border border-white/[0.09] bg-white/[0.035] px-3 py-2 text-left transition hover:border-cyan-300/25 hover:bg-cyan-300/[0.05] disabled:opacity-50"><FileText size={14} className="shrink-0 text-cyan-300"/><span className="min-w-0"><span className="block font-mono text-[9px] font-semibold tracking-wide text-zinc-200">POSITION METADATA CSV</span><span className="block truncate text-[9px] text-zinc-500">{loading ? 'Reading track…' : metadataName || 'Choose synchronized metadata'}</span></span></button>
          <input ref={videoInputRef} type="file" accept="video/*,.ts,.mpg,.mpeg,.mp4,.mov,.webm" className="hidden" onChange={event => selectVideo(event.target.files?.[0])}/>
          <input ref={metadataInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) void loadMetadata(file); }}/>
        </div>

        {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2 text-[10px] text-rose-200"><AlertCircle size={14} className="mt-0.5 shrink-0"/>{error}</div>}

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-white/[0.07] bg-white/[0.025] px-2.5 py-2"><div className="font-mono text-[8px] tracking-[0.1em] text-zinc-500">TRACK FRAMES</div><div className="mt-1 font-mono text-xs font-semibold tabular-nums text-white">{frames.length.toLocaleString()}</div></div>
          <div className="rounded-lg border border-white/[0.07] bg-white/[0.025] px-2.5 py-2"><div className="font-mono text-[8px] tracking-[0.1em] text-zinc-500">VIDEO TIME</div><div className="mt-1 font-mono text-xs font-semibold tabular-nums text-cyan-200">{frameTime}</div></div>
          <div className="rounded-lg border border-white/[0.07] bg-white/[0.025] px-2.5 py-2"><div className="font-mono text-[8px] tracking-[0.1em] text-zinc-500">SENSOR</div><div className="mt-1 flex items-center gap-1 font-mono text-[10px] font-semibold tabular-nums text-emerald-200">{currentFrame ? <><MapPin size={11}/>{currentFrame.sensor.lat.toFixed(4)}, {currentFrame.sensor.lng.toFixed(4)}</> : '—'}</div></div>
        </div>
        <p className="text-[9px] leading-relaxed text-zinc-500">Load a CSV with timestamps and sensor latitude/longitude to synchronize the trail. For an exact frame footprint, include the four frame-corner coordinates for each timestamp; FOV-derived footprints are approximate. The supplied GIFs are visual references, not georeferenced source footage.</p>
      </div>
    </section>
  );
}

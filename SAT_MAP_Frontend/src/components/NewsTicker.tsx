"use client";

import { useState, useEffect } from "react";
import { Radio, ExternalLink, Pause, Play } from "lucide-react";
import { api } from "@/config/api";

export interface TickerItem {
  id: string;
  type: "market" | "news" | "status";
  icon?: string;
  label?: string;
  value?: string;
  change?: string;
  changeType?: "up" | "down" | "neutral";
  lat?: number;
  lng?: number;
  url?: string;
}

interface NewsTickerProps {
  onFlyToLocation?: (coords: {
    lat: number;
    lng: number;
    zoom?: number;
  }) => void;
}

export default function NewsTicker({ onFlyToLocation }: NewsTickerProps) {
  const [newsItems, setNewsItems] = useState<TickerItem[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [streamStatus, setStreamStatus] = useState<"connecting" | "live" | "reconnecting">("connecting");

  // The OSINT service sends the current feed and subsequent updates over SSE.
  useEffect(() => {
    const stream = new EventSource(api.newsStream());
    stream.onopen = () => setStreamStatus("live");
    stream.onerror = () => setStreamStatus("reconnecting");
    stream.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!Array.isArray(data?.items)) return;
        const mapped: TickerItem[] = data.items.slice(0, 12).map((item: {
          id: string;
          title: string;
          source?: string;
          category?: string;
          latitude?: number | null;
          longitude?: number | null;
          link?: string;
        }) => ({
          id: `news-${item.id}`,
          type: "news",
          label: item.source || item.category?.toUpperCase() || "OSINT",
          value: item.title,
          lat: item.latitude ?? undefined,
          lng: item.longitude ?? undefined,
          url: item.link,
        }));
        setNewsItems(mapped);
      } catch {
        // EventSource reconnects automatically after malformed or interrupted events.
      }
    };
    return () => stream.close();
  }, []);

  const tickerItems = newsItems;
  const handleItemClick = (item: TickerItem) => {
    if (
      typeof item.lat === "number" &&
      typeof item.lng === "number" &&
      onFlyToLocation
    ) {
      onFlyToLocation({ lat: item.lat, lng: item.lng, zoom: 6 });
    } else if (item.url && typeof window !== "undefined") {
      window.open(item.url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <footer
      data-hud
      aria-label="Bottom Television News Ticker Crawl"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className="fixed bottom-0 left-0 right-0 z-210 w-full h-7 sm:h-7.5 bg-[#050811]/95 border-t border-cyan-500/20 backdrop-blur-2xl flex items-center select-none pointer-events-auto overflow-hidden transition-all"
    >
      {/* ── 2. CHANNEL / TV SUB-HEADER TAG ── */}
      <div className="hidden md:flex items-center gap-1.5 h-full px-2.5 bg-[#090e1c] border-r border-white/10 text-cyan-400 font-mono text-[9px] font-bold tracking-widest uppercase flex-shrink-0 z-20">
        <Radio size={11} className="text-cyan-400 animate-pulse" />
        <span className="text-cyan-300">OSINT {streamStatus.toUpperCase()}</span>
      </div>

      {/* ── 3. TV NEWS CRAWL TRACK (HORIZONTAL MOVING LINE) ── */}
      <div className="relative flex-1 overflow-hidden h-full flex items-center">
        {/* Edge Fade Gradients */}
        <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-[#050811] to-transparent z-10" />
        <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[#050811] to-transparent z-10" />

        {/* Continuous Crawl Animation Strip */}
        <div
          className={`animate-tv-ticker flex items-center ${isPaused ? "ticker-paused" : ""}`}
          style={{ animationDuration: "65s" }}
        >
          {/* Duplicate loop for infinite TV news marquee scroll */}
          {[...tickerItems, ...tickerItems].map((item, index) => (
            <div
              key={`${item.id}-${index}`}
              onClick={() => handleItemClick(item)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleItemClick(item);
              }}
              className="flex items-center gap-1.5 font-mono text-[10px] cursor-pointer hover:bg-white/10 px-2 py-0.5 rounded transition flex-shrink-0"
              title={
                item.lat
                  ? `Click to fly to ${item.label || item.value} on map`
                  : item.url
                    ? "Click to open source dispatch"
                    : undefined
              }
            >
              {/* Optional Icon */}
              {item.icon && (
                <span className="text-[10px] flex-shrink-0 leading-none">
                  {item.icon}
                </span>
              )}

              {/* Label (e.g. M5.1 or SPACE or BTC) */}
              {item.label && (
                <span
                  className={`font-black ${
                    item.type === "market"
                        ? "text-zinc-300"
                        : "text-cyan-300"
                  }`}
                >
                  {item.label}
                </span>
              )}

              {/* Content / Value */}
              {item.value && (
                <span
                  className={`font-medium ${
                    item.type === "market"
                        ? "text-white font-bold"
                        : "text-zinc-100"
                  }`}
                >
                  {item.value}
                </span>
              )}

              {/* Market Change or Urgency Tag */}
              {item.change && (
                <span
                  className={`text-[9px] font-bold ${
                    item.changeType === "up"
                      ? "text-emerald-400"
                      : item.changeType === "down"
                        ? "text-rose-400"
                        : "text-zinc-400"
                  }`}
                >
                  {item.change}
                </span>
              )}

              {/* Fly-to or Link hint */}
              {item.lat && (
                <span className="text-[8px] text-cyan-400/80 font-bold bg-cyan-500/10 px-1 py-0.2 rounded border border-cyan-400/25">
                  LOCATE
                </span>
              )}
              {item.url && !item.lat && (
                <ExternalLink
                  size={9}
                  className="text-zinc-500 hover:text-cyan-300"
                />
              )}

              {/* Broadcast Divider Pip */}
              <span className="text-zinc-700 font-bold mx-2 select-none">
                |
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── 4. RIGHT TV CONTROLS & STATUS BADGE ── */}
      <div className="flex items-center gap-2 pl-2.5 pr-3 h-full bg-[#050811] border-l border-white/10 flex-shrink-0 z-20">
        {/* Pause/Play Quick Toggle */}
        <button
          type="button"
          onClick={() => setIsPaused((p) => !p)}
          title={isPaused ? "Resume news ticker" : "Pause news ticker"}
          className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
        >
          {isPaused ? (
            <Play size={11} className="text-amber-300 fill-amber-300" />
          ) : (
            <Pause size={11} />
          )}
        </button>

        {/* Status: 🟢 ONLINE */}
        <div className="flex items-center gap-1.5 font-mono text-[9px] font-bold text-emerald-400 tracking-wider">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981] animate-pulse" />
          <span>ONLINE</span>
        </div>
      </div>
    </footer>
  );
}

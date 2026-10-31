"use client";

interface RightTacticalDockProps {
  isAreaDrawerOpen: boolean;
  onToggleAreaDrawer: () => void;
  onOpenShipHeatmap: () => void;
}

export default function RightTacticalDock({
  isAreaDrawerOpen,
  onToggleAreaDrawer,
  onOpenShipHeatmap,
}: RightTacticalDockProps) {
  return (
    <aside
      data-hud
      aria-label="Orbital Intelligence Quick Access"
      className="
        fixed left-3 top-1/2 -translate-y-1/2
        z-[206] flex flex-col items-center
        w-[54px] py-3 gap-2
        rounded-[22px]
        border border-white/[0.10]
        shadow-[0_18px_55px_rgba(0,0,0,0.48)]
        backdrop-blur-2xl
        select-none pointer-events-auto
        transition-all duration-300
      "
      style={{
        background:
          "linear-gradient(180deg, rgba(18,22,27,0.92), rgba(8,11,15,0.88))",
      }}
    >
      <div className="relative group flex justify-center w-full">
        <button type="button" onClick={onOpenShipHeatmap} aria-label="Select area and show vessel heat map" title="Vessel activity heat map" className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-transparent text-amber-300/75 transition hover:border-amber-300/20 hover:bg-amber-300/10 hover:text-amber-200">
          <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 5.5 8 3l8 2.5L21 3v15.5L16 21l-8-2.5L3 21z"/><path d="M8 3v15.5M16 5.5V21M11 9c0-1.2 1.1-2.3 2.1-3.5 1 1.2 2.1 2.3 2.1 3.5a2.1 2.1 0 1 1-4.2 0Z"/></svg>
        </button>
        <div className="pointer-events-none invisible absolute left-full top-1/2 z-[220] ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-[#090d13]/95 px-3 py-2 font-mono text-[10px] text-zinc-100 opacity-0 transition group-hover:visible group-hover:opacity-100">VESSEL AREA HEAT MAP</div>
      </div>
      {/* Orbital Intelligence control */}
      <div className="relative group flex justify-center w-full">
        <button
          type="button"
          onClick={onToggleAreaDrawer}
          aria-label={
            isAreaDrawerOpen
              ? "Close Satellite Access Drawer"
              : "Open Satellite Access Drawer"
          }
          aria-expanded={isAreaDrawerOpen}
          aria-controls="satellite-access-drawer"
          title="Orbital Intelligence"
          className={`
            relative flex items-center justify-center
            w-10 h-10 rounded-[14px]
            border transition-all duration-200
            active:scale-95
            focus-visible:outline-none
            focus-visible:ring-2 focus-visible:ring-cyan-300/60
            ${
              isAreaDrawerOpen
                ? "border-cyan-400/30 bg-cyan-400/[0.15] shadow-[0_0_18px_rgba(0,229,255,0.12)]"
                : "border-transparent bg-transparent hover:bg-white/[0.07] hover:border-white/[0.08]"
            }
          `}
        >
          {/* Orbital SVG */}
          <svg
            viewBox="0 0 24 24"
            width="21"
            height="21"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={`transition-all duration-300 ${
              isAreaDrawerOpen
                ? "text-cyan-300 drop-shadow-[0_0_7px_rgba(0,229,255,0.65)]"
                : "text-slate-300/60 group-hover:text-cyan-200"
            }`}
          >
            <circle
              cx="12"
              cy="12"
              r="3"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <ellipse
              cx="12"
              cy="12"
              rx="10"
              ry="4.5"
              transform="rotate(-35 12 12)"
              stroke="currentColor"
              strokeWidth="1.2"
            />
            <circle cx="20.1" cy="7.1" r="1.7" fill="currentColor" />
            <circle cx="12" cy="12" r="1" fill="currentColor" />
          </svg>

          {/* Active indicator */}
          {isAreaDrawerOpen && (
            <span
              className="
                absolute -right-1 -top-1
                w-2.5 h-2.5 rounded-full
                bg-cyan-400 border-2 border-[#11171b]
                shadow-[0_0_9px_rgba(0,229,255,0.8)]
              "
            />
          )}
        </button>

        {/* Reference-style tooltip */}
        <div
          className="
            pointer-events-none absolute left-full ml-3 top-1/2
            -translate-y-1/2 translate-x-1
            opacity-0 invisible
            group-hover:opacity-100 group-hover:visible
            group-hover:translate-x-0
            transition-all duration-200
            whitespace-nowrap z-[220]
            rounded-xl border border-white/[0.10]
            bg-[#090d13]/95 backdrop-blur-2xl
            px-3 py-2
            shadow-[0_12px_32px_rgba(0,0,0,0.55)]
          "
        >
          <div className="flex items-center gap-2">
            <span
              className={`
                w-1.5 h-1.5 rounded-full
                ${
                  isAreaDrawerOpen
                    ? "bg-cyan-400 shadow-[0_0_7px_#00e5ff]"
                    : "bg-zinc-500"
                }
              `}
            />
            <span className="text-[10px] font-mono font-semibold tracking-[0.13em] text-zinc-100">
              ORBITAL INTELLIGENCE
            </span>
          </div>

          <span className="block mt-1 ml-3.5 text-[9px] font-mono tracking-wider text-zinc-500">
            {isAreaDrawerOpen
              ? "SATELLITE ACCESS ACTIVE"
              : "OPEN SATELLITE ACCESS"}
          </span>
        </div>
      </div>
    </aside>
  );
}

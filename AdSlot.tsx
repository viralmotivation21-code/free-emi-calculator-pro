interface AdSlotProps {
  format?: "leaderboard" | "inline" | "rectangle";
  slotId?: string;
  className?: string;
}

/**
 * Advertisement placement container.
 * - Keeps a reserved, labelled space for AdSense / any ad network.
 * - `overflow:hidden` + `max-width:100%` guarantee ads can never break
 *   the calculator, the amortisation table, scrolling or mobile layout.
 * - To activate: paste your ad script in index.html and render your
 *   <ins class="adsbygoogle"> unit inside .ad-body (or mount it here).
 */
export default function AdSlot({ format = "inline", slotId = "ad-slot", className = "" }: AdSlotProps) {
  const heights: Record<string, string> = {
    leaderboard: "min-h-[100px]",
    inline: "min-h-[110px]",
    rectangle: "min-h-[250px]",
  };
  return (
    <div className={`ad-slot no-print ${className}`} role="complementary" aria-label="Advertisement">
      <span className="ad-label">Advertisement</span>
      <div className={`ad-body ${heights[format]}`} id={slotId} data-ad-format={format}>
        <p className="max-w-md leading-relaxed">
          Ad space — your AdSense unit renders here. Calculations on this page are 100% client-side
          and never affected by ads.
        </p>
      </div>
    </div>
  );
}

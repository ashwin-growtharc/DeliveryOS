'use client';

import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  motion,
  useMotionTemplate,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from 'framer-motion';
import { cn } from './cn';

/**
 * A pinned, stacking-on-scroll card sequence: the section locks to the
 * viewport, and each card travels into place as you scroll, then parks as a
 * collapsed title bar while the next one takes over. Cards you have passed
 * stay above as title bars, cards you have not reached wait below as title
 * bars — every title bar is a control that seeks straight to its card.
 *
 * Ported from Suna's own platform-stack marketing section
 * (`apps/web/src/features/marketing/how-it-work/how-it-works.tsx`) — the
 * scroll/pin/dock geometry is the genuinely reusable part of that section;
 * its six bespoke per-layer product-panel simulations and Kortix's own
 * six-layer narrative copy are not (see this kit's README "Not included, and
 * why" for the same judgment call applied elsewhere in this kit). `panel` is
 * a plain slot here instead — pass whatever a given product actually needs
 * to show per card, or omit it for a text-only card.
 *
 * Below `lg`, and under `prefers-reduced-motion`, this renders as a plain
 * vertical list of the same cards — no pinning, no scroll-driven transforms.
 */

export type StackedScrollCard = {
  /** Stable id, used as the React key and the card's `data-stack-card` hook. */
  id: string;
  /** Short ordinal shown in the title bar's left gutter, e.g. "01". */
  ordinal: string;
  title: string;
  description: string;
  /** Up to a few short facts rendered as a bullet list beside `panel`. */
  bullets?: string[];
  /** Whatever this card should show beside its copy — an illustration, a
   *  mini product mockup, or omit it for a text-only card. */
  panel?: React.ReactNode;
  /** The closing, full-stop card: centered body, no bullets, no panel. */
  isClosing?: boolean;
};

export interface StackedScrollCardsProps {
  eyebrow?: string;
  title: string;
  description?: string;
  cards: StackedScrollCard[];
  className?: string;
}

/** SSR-safe `matchMedia` hook, so pinning only turns on once we know we're on
 *  a wide-enough viewport (mirrors Suna's own `useMediaQuery`, inlined so
 *  this component has no sibling-hook dependency to copy in). */
function useIsDesktop(query = '(min-width: 1024px)'): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/**
 * A real cubic-bezier easing FUNCTION, not the raw `[x1,y1,x2,y2]` control-point
 * tuple: `useTransform`'s own `ease` option calls each array entry as a
 * function per interpolation segment, so passing the numeric tuple directly
 * throws (`TypeError: e is not a function`) the first time the transform
 * actually runs — it renders fine at rest, which is exactly the kind of bug
 * step 6 above exists to catch. Standard Newton-Raphson bezier solve, kept
 * local rather than importing `cubicBezier` from `motion/react` (unavailable
 * in this sandbox — only the `framer-motion` package is, per this kit's own
 * import-rewrite table above).
 */
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const a = (a1: number, a2: number) => 1 - 3 * a2 + 3 * a1;
  const b = (a1: number, a2: number) => 3 * a2 - 6 * a1;
  const c = (a1: number) => 3 * a1;

  const bezier = (t: number, a1: number, a2: number) =>
    ((a(a1, a2) * t + b(a1, a2)) * t + c(a1)) * t;
  const bezierSlope = (t: number, a1: number, a2: number) =>
    3 * a(a1, a2) * t * t + 2 * b(a1, a2) * t + c(a1);

  function tForX(x: number): number {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const slope = bezierSlope(t, x1, x2);
      if (slope === 0) break;
      t -= (bezier(t, x1, x2) - x) / slope;
    }
    return t;
  }

  return (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : bezier(tForX(t), y1, y2));
}

/** Cards decelerate into place rather than tracking the scroll on a hard ramp. */
const TRAVEL_EASE = cubicBezier(0.33, 0, 0.15, 1);

/**
 * The height of one collapsed title bar, in px. `lastIndex` of these are
 * always reserved (`i` above the active card, `lastIndex - i` below it), so
 * every 4px here costs the active card's panel 24px at 7 cards — kept as
 * small as a 15px title can legibly sit in.
 */
function stripHeight(viewportHeight: number): number {
  return Math.round(Math.min(34, Math.max(28, viewportHeight * 0.034)));
}

function Card({
  card,
  index,
  lastIndex,
  pinned,
  frame,
  strip,
  progress,
  onSeek,
}: {
  card: StackedScrollCard;
  index: number;
  lastIndex: number;
  pinned: boolean;
  frame: number;
  strip: number;
  progress: MotionValue<number>;
  onSeek: (index: number) => void;
}): React.ReactNode {
  const restTop = index * strip;
  const dockTop = frame - (lastIndex - index + 1) * strip;

  const arriveFrom = (index - 1) / lastIndex;
  const arriveTo = index / lastIndex;
  const recedeTo = Math.min(index + 3, lastIndex) / lastIndex;

  const y = useTransform(progress, [arriveFrom, arriveTo], [dockTop - restTop, 0], {
    clamp: true,
    ease: TRAVEL_EASE,
  });
  const depth = useTransform(progress, [arriveTo, recedeTo], [0, 1], { clamp: true });
  const blurPx = useTransform(depth, [0, 1], [0, 6]);
  const bodyOpacity = useTransform(depth, [0, 1], [1, 0.4]);
  const filter = useMotionTemplate`blur(${blurPx}px)`;

  const isLast = index === lastIndex;
  const live = pinned && frame > 0;

  return (
    <motion.article
      data-stack-card={card.id}
      data-pinned={live ? 'true' : 'false'}
      style={
        live
          ? {
              top: restTop,
              height: frame - lastIndex * strip,
              zIndex: index,
              y,
              willChange: 'transform',
            }
          : undefined
      }
      className={cn(
        'border-border bg-popover flex flex-col overflow-hidden rounded-xl border',
        live ? 'absolute inset-x-0' : 'relative',
      )}
    >
      <button
        type="button"
        onClick={() => onSeek(index)}
        data-card-head
        style={live ? { height: strip } : undefined}
        className="hover:bg-muted/50 flex w-full shrink-0 cursor-pointer items-center gap-3 px-4 py-1 text-left transition-colors sm:px-6"
      >
        <span className="text-muted-foreground/60 font-mono text-[11px] tracking-widest tabular-nums">
          {card.ordinal}
        </span>
        <h3 className="text-foreground truncate text-[15px] font-medium tracking-tight sm:text-base">
          {card.title}
        </h3>
      </button>

      <motion.div
        data-card-body
        style={live && !isLast ? { filter, opacity: bodyOpacity, willChange: 'filter' } : undefined}
        className={cn(
          'border-border bg-muted/40 dark:bg-muted/15 min-h-0 flex-1 border-t p-2',
          card.isClosing
            ? 'flex items-center justify-center'
            : 'grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:gap-4',
        )}
      >
        {card.isClosing ? (
          <div
            className={cn(
              'flex flex-col items-center justify-center gap-4 text-center',
              live ? 'h-full' : 'py-16',
            )}
          >
            <p className="text-foreground max-w-md text-balance">{card.description}</p>
          </div>
        ) : (
          <>
            <div className="flex min-w-0 flex-col gap-2.5 lg:pl-1">
              <p className="text-muted-foreground text-[13px] leading-relaxed">
                {card.description}
              </p>
              {card.bullets && card.bullets.length > 0 && (
                <ul className="text-muted-foreground space-y-1.5 text-[12.5px] leading-relaxed">
                  {card.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-2">
                      <span aria-hidden className="bg-foreground/40 mt-1.5 size-1 shrink-0 rounded-full" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {card.panel && (
              <div className={cn('min-h-0 w-full', live ? 'h-full' : 'h-[16rem] sm:h-[19rem]')}>
                {card.panel}
              </div>
            )}
          </>
        )}
      </motion.div>
    </motion.article>
  );
}

export function StackedScrollCards({
  eyebrow,
  title,
  description,
  cards,
  className,
}: StackedScrollCardsProps): React.ReactNode {
  const reduced = useReducedMotion();
  const isDesktop = useIsDesktop();
  const pinned = isDesktop && !reduced;
  const lastIndex = cards.length - 1;

  const sectionRef = useRef<HTMLElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState(0);
  const [strip, setStrip] = useState(() => stripHeight(900));

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end end'],
  });

  useEffect(() => {
    const el = stackRef.current;
    if (!el || !pinned) {
      setFrame(0);
      return;
    }
    const sync = () => {
      setFrame(el.getBoundingClientRect().height);
      setStrip(stripHeight(window.innerHeight));
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    window.addEventListener('resize', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [pinned]);

  const seek = useCallback(
    (index: number) => {
      const el = sectionRef.current;
      if (!el || !pinned) return;
      const { top, height } = el.getBoundingClientRect();
      const pinDistance = height - window.innerHeight;
      window.scrollTo({
        top: top + window.scrollY + (pinDistance * index) / lastIndex,
        behavior: 'smooth',
      });
    },
    [pinned, lastIndex],
  );

  return (
    <section
      ref={sectionRef}
      className={cn('relative', pinned && 'lg:h-[260vh]', className)}
    >
      <div className={cn(pinned && 'sticky top-0 flex h-[100svh] flex-col overflow-hidden')}>
        <div className="mx-auto w-full max-w-7xl shrink-0 px-6 pt-[4.75rem] [@media(max-height:860px)]:pt-[4.5rem]">
          {eyebrow && (
            <span className="border-border text-muted-foreground inline-block rounded border px-2 py-0.5 font-mono text-[10px] tracking-widest uppercase">
              {eyebrow}
            </span>
          )}
          <h2 className="text-foreground mt-3 max-w-3xl text-2xl font-medium tracking-tight text-balance sm:text-3xl [@media(max-height:860px)]:mt-2 [@media(max-height:860px)]:sm:text-2xl">
            {title}
          </h2>
          {description && (
            <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed [@media(max-height:860px)]:hidden">
              {description}
            </p>
          )}
        </div>

        <div
          className={cn(
            'mx-auto w-full max-w-7xl px-6',
            pinned ? 'mt-3 min-h-0 flex-1 pb-4' : 'mt-8 pb-16 sm:mt-10',
          )}
        >
          <div
            ref={stackRef}
            className={cn(pinned ? 'relative h-full overflow-hidden' : 'flex flex-col gap-5')}
          >
            {cards.map((card, index) => (
              <Card
                key={card.id}
                card={card}
                index={index}
                lastIndex={lastIndex}
                pinned={pinned}
                frame={frame}
                strip={strip}
                progress={scrollYProgress}
                onSeek={seek}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

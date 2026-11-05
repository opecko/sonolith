// Renderers of the slide styles, by id (metadata in recap/styles.ts). A test keeps both lists in step.
import type { ComponentType } from "react";
import type { StyleId } from "../../styles";
import type { StyleProps } from "../parts";
import { Equalizer, Heatmap, RadialClock, RisingBars, Timeline, Waveform } from "./charts";
import { AlbumWall, Bubbles, Constellation, Countdown, CrateFlip, Podium, Spotlight, Stickers, TradingCard } from "./lists";
import { GiantNumber, Marquee, Newspaper, NumeralStack, Odometer, Poster, Receipt, Scratch, Terminal } from "./print";
import { Cassette, Donut, Forecast, Magazine, Medal, Polaroids, SlotMachine, SplitFlap } from "./extra";
import { Chat, Ticket, Versus } from "./talk";

export const STYLE_COMPONENTS: Record<StyleId, ComponentType<StyleProps>> = {
  podium: Podium,
  numeralStack: NumeralStack,
  crateFlip: CrateFlip,
  marquee: Marquee,
  poster: Poster,
  receipt: Receipt,
  risingBars: RisingBars,
  bubbles: Bubbles,
  odometer: Odometer,
  giantNumber: GiantNumber,
  radialClock: RadialClock,
  heatmap: Heatmap,
  waveform: Waveform,
  timeline: Timeline,
  tradingCard: TradingCard,
  stickers: Stickers,
  chat: Chat,
  terminal: Terminal,
  newspaper: Newspaper,
  ticket: Ticket,
  albumWall: AlbumWall,
  equalizer: Equalizer,
  spotlight: Spotlight,
  versus: Versus,
  countdown: Countdown,
  scratch: Scratch,
  constellation: Constellation,
  splitFlap: SplitFlap,
  polaroids: Polaroids,
  cassette: Cassette,
  donut: Donut,
  slotMachine: SlotMachine,
  magazine: Magazine,
  medal: Medal,
  forecast: Forecast,
};

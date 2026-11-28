/**
 * The line symbols a dashboard can take as its icon — the rail's own style
 * (lucide), as the built-in dashboards have them.
 *
 * A chosen symbol is stored in `dashboards.icon` as `symbol:` plus its lucide
 * name (`symbol:book-open`), beside the two other icon kinds of that column: an
 * emoji, or the stored name of a file in `icons/`. The prefix keeps the three
 * apart — a symbol value is never a file name (`storedImageName`) and never
 * shown as text. Only the names listed here are symbols; any other `symbol:`
 * value is no icon at all, and the dashboard falls back to its default glyph.
 *
 * The labels live under `dashboardSymbols.<name>` in the locale files; the
 * picker searches them in the app's language and the English name besides.
 */
import {
  Activity, Anchor, Archive, Atom, Bird, BookMarked, BookOpen, Box, Brain, Briefcase, Brush,
  CalendarDays, Camera, Castle, Cat, Church, Clock, Cloud, Code, Coffee, Compass, Crown,
  Dice5, Droplet, Dumbbell, Eye, Feather, Film, Fish, Flag, FlaskConical, Flame, Flower2,
  FolderHeart, Gamepad2, Gem, Ghost, Gift, Globe, GraduationCap, Hammer, Heart, HeartPulse,
  Hourglass, House, Image as ImageIcon, Infinity as InfinityIcon, Key, Landmark, Layers, Leaf, Library, Lightbulb, ListTodo, Mail,
  Map as MapIcon, MessageCircle, Moon, Mountain, Music, Newspaper, Notebook, NotebookPen, Orbit, Palette,
  PawPrint, PenTool, Pill, Plane, Puzzle, Pyramid, Rocket, ScrollText, Shield, Skull,
  Snowflake, Sparkles, Sprout, Star, Sun, Sunrise, Sunset, Sword, Swords, Tag, Target, Telescope,
  Tent, Trees, Trophy, User, Users, Utensils, WandSparkles, Waves, Wind, Wine, Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * The curated selection, in the order the picker shows it: writing and
 * knowledge first, then sky, nature, the esoteric, life and things.
 */
export const DASHBOARD_SYMBOLS = {
  'book-open': BookOpen,
  library: Library,
  notebook: Notebook,
  'notebook-pen': NotebookPen,
  'book-marked': BookMarked,
  'scroll-text': ScrollText,
  feather: Feather,
  'pen-tool': PenTool,
  newspaper: Newspaper,
  moon: Moon,
  sun: Sun,
  star: Star,
  sparkles: Sparkles,
  sunrise: Sunrise,
  sunset: Sunset,
  orbit: Orbit,
  telescope: Telescope,
  atom: Atom,
  cloud: Cloud,
  leaf: Leaf,
  sprout: Sprout,
  'flower-2': Flower2,
  trees: Trees,
  mountain: Mountain,
  droplet: Droplet,
  waves: Waves,
  wind: Wind,
  snowflake: Snowflake,
  flame: Flame,
  zap: Zap,
  'wand-sparkles': WandSparkles,
  'flask-conical': FlaskConical,
  gem: Gem,
  crown: Crown,
  key: Key,
  eye: Eye,
  skull: Skull,
  ghost: Ghost,
  shield: Shield,
  sword: Sword,
  swords: Swords,
  infinity: InfinityIcon,
  pyramid: Pyramid,
  heart: Heart,
  'heart-pulse': HeartPulse,
  brain: Brain,
  lightbulb: Lightbulb,
  puzzle: Puzzle,
  target: Target,
  trophy: Trophy,
  flag: Flag,
  rocket: Rocket,
  compass: Compass,
  map: MapIcon,
  globe: Globe,
  landmark: Landmark,
  castle: Castle,
  church: Church,
  tent: Tent,
  house: House,
  'calendar-days': CalendarDays,
  clock: Clock,
  hourglass: Hourglass,
  'list-todo': ListTodo,
  archive: Archive,
  'folder-heart': FolderHeart,
  layers: Layers,
  box: Box,
  gift: Gift,
  tag: Tag,
  music: Music,
  palette: Palette,
  brush: Brush,
  camera: Camera,
  film: Film,
  image: ImageIcon,
  'gamepad-2': Gamepad2,
  'dice-5': Dice5,
  users: Users,
  user: User,
  'paw-print': PawPrint,
  cat: Cat,
  bird: Bird,
  fish: Fish,
  briefcase: Briefcase,
  'graduation-cap': GraduationCap,
  'message-circle': MessageCircle,
  mail: Mail,
  coffee: Coffee,
  utensils: Utensils,
  wine: Wine,
  dumbbell: Dumbbell,
  activity: Activity,
  pill: Pill,
  plane: Plane,
  anchor: Anchor,
  hammer: Hammer,
  code: Code,
} as const satisfies Record<string, LucideIcon>;

export type DashboardSymbolName = keyof typeof DASHBOARD_SYMBOLS;

export const DASHBOARD_SYMBOL_NAMES = Object.keys(DASHBOARD_SYMBOLS) as DashboardSymbolName[];

const PREFIX = 'symbol:';

/** The icon value that stores a symbol. */
export function symbolIconValue(name: DashboardSymbolName): string {
  return `${PREFIX}${name}`;
}

/** Whether an icon value is in the symbol format at all — known name or not. Such a value is neither emoji nor file. */
export function isSymbolIconValue(icon: string | null | undefined): boolean {
  return !!icon && icon.startsWith(PREFIX);
}

/** The symbol an icon value names; `null` for an emoji, a file, or a `symbol:` value naming none of the list. */
export function dashboardSymbol(icon: string | null | undefined): LucideIcon | null {
  if (!isSymbolIconValue(icon)) return null;
  const name = icon!.slice(PREFIX.length);
  return Object.prototype.hasOwnProperty.call(DASHBOARD_SYMBOLS, name) ? DASHBOARD_SYMBOLS[name as DashboardSymbolName] : null;
}

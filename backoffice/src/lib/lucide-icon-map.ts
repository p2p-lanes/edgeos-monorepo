/**
 * Curated registry of lucide-react icons usable by user-entered names.
 *
 * WHY this file exists: `import * as Lucide from "lucide-react"` + runtime
 * lookup (`Lucide[someVar]`) is tree-shaken by the bundler. Icons need to
 * be imported by name so they survive into the production build. When a
 * new icon name should be allowed, add its named import + a map entry.
 */
import type { ComponentType } from "react"
import {
  Accessibility,
  AirVent,
  Armchair,
  Baby,
  Bath,
  Bed,
  Bike,
  Book,
  Bus,
  Calendar,
  Camera,
  Car,
  Cat,
  Clock,
  Coffee,
  Dog,
  Droplet,
  Eye,
  Fan,
  Film,
  Flame,
  Folder,
  Gamepad2,
  Gift,
  Globe,
  Hammer,
  Headphones,
  Heart,
  Hotel,
  Key,
  Laptop,
  Leaf,
  Lightbulb,
  Mic,
  MicVocal,
  Monitor,
  Music,
  Package,
  Palette,
  ParkingCircle,
  ParkingMeter,
  Pencil,
  Phone,
  PhoneCall,
  Plug,
  Printer,
  Projector,
  Radio,
  Rocket,
  Shield,
  Snowflake,
  Sofa,
  Speaker,
  Stethoscope,
  Sun,
  Table,
  Tent,
  Tv,
  Umbrella,
  Utensils,
  Video,
  Volume2,
  Waves,
  Wifi,
  Wrench,
  Zap,
} from "lucide-react"

type IconComponent = ComponentType<{ className?: string }>

// Canonical PascalCase → component map. Each entry is a lucide icon that
// will actually exist in the JS bundle (bundler sees the named import).
const ICONS: Record<string, IconComponent> = {
  Accessibility,
  AirVent,
  Armchair,
  Baby,
  Bath,
  Bed,
  Bike,
  Book,
  Bus,
  Calendar,
  Camera,
  Car,
  Cat,
  Clock,
  Coffee,
  Dog,
  Droplet,
  Eye,
  Fan,
  Film,
  Flame,
  Folder,
  Gamepad2,
  Gift,
  Globe,
  Hammer,
  Headphones,
  Heart,
  Hotel,
  Key,
  Laptop,
  Leaf,
  Lightbulb,
  Mic,
  MicVocal,
  Monitor,
  Music,
  Package,
  Palette,
  ParkingCircle,
  ParkingMeter,
  Pencil,
  Phone,
  PhoneCall,
  Plug,
  Printer,
  Projector,
  Radio,
  Rocket,
  Shield,
  Snowflake,
  Sofa,
  Speaker,
  Stethoscope,
  Sun,
  Table,
  Tent,
  Tv,
  Umbrella,
  Utensils,
  Video,
  Volume2,
  Waves,
  Wifi,
  Wrench,
  Zap,
}

// Friendly aliases — lowercase kebab/snake/plain → canonical PascalCase.
// Covers the usual names people will type (including the exact slugs on
// lucide.dev).
const ALIASES: Record<string, string> = {
  // Audio
  microphone: "Mic",
  "mic-vocal": "MicVocal",
  // Video / displays
  tv: "Tv",
  monitor: "Monitor",
  projector: "Projector",
  screen: "Monitor",
  camera: "Camera",
  video: "Video",
  film: "Film",
  // Connectivity / power
  wifi: "Wifi",
  "wi-fi": "Wifi",
  internet: "Wifi",
  plug: "Plug",
  outlet: "Plug",
  power: "Zap",
  zap: "Zap",
  lightbulb: "Lightbulb",
  light: "Lightbulb",
  // Furniture / capacity
  sofa: "Sofa",
  couch: "Sofa",
  armchair: "Armchair",
  chair: "Armchair",
  chairs: "Armchair",
  bed: "Bed",
  table: "Table",
  // Transport
  car: "Car",
  parking: "ParkingCircle",
  "parking-circle": "ParkingCircle",
  "parking-meter": "ParkingMeter",
  bike: "Bike",
  bus: "Bus",
  // Food / drink
  coffee: "Coffee",
  utensils: "Utensils",
  food: "Utensils",
  // Water / weather
  bath: "Bath",
  droplet: "Droplet",
  water: "Droplet",
  waves: "Waves",
  pool: "Waves",
  fan: "Fan",
  "air-vent": "AirVent",
  ac: "Snowflake",
  snowflake: "Snowflake",
  sun: "Sun",
  // Tools
  wrench: "Wrench",
  hammer: "Hammer",
  // Animals
  dog: "Dog",
  cat: "Cat",
  // Misc
  folder: "Folder",
  heart: "Heart",
  key: "Key",
  lock: "Shield",
  shield: "Shield",
  umbrella: "Umbrella",
  leaf: "Leaf",
  hotel: "Hotel",
  tent: "Tent",
  globe: "Globe",
  rocket: "Rocket",
  gift: "Gift",
  calendar: "Calendar",
  clock: "Clock",
  eye: "Eye",
  pencil: "Pencil",
  accessibility: "Accessibility",
  wheelchair: "Accessibility",
  baby: "Baby",
  music: "Music",
  speaker: "Speaker",
  headphones: "Headphones",
  radio: "Radio",
  "volume-2": "Volume2",
  phone: "Phone",
  "phone-call": "PhoneCall",
  laptop: "Laptop",
  printer: "Printer",
  gamepad: "Gamepad2",
  "gamepad-2": "Gamepad2",
  stethoscope: "Stethoscope",
  book: "Book",
  palette: "Palette",
  package: "Package",
  box: "Package",
  flame: "Flame",
}

function toPascalCase(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join("")
}

/** Resolve a user-entered icon name to a Lucide component, or null. */
export function resolveLucideIcon(
  name: string | null | undefined,
): IconComponent | null {
  if (!name) return null
  const raw = name.trim()
  if (!raw) return null

  // 1. Canonical PascalCase direct hit.
  if (ICONS[raw]) return ICONS[raw]

  // 2. Alias lookup (lowercased).
  const lower = raw.toLowerCase()
  const aliased = ALIASES[lower]
  if (aliased && ICONS[aliased]) return ICONS[aliased]

  // 3. Normalize to PascalCase ('mic-vocal' → 'MicVocal') as a last try.
  const pascal = toPascalCase(raw)
  if (ICONS[pascal]) return ICONS[pascal]

  return null
}

/** List of canonical icon names — useful for a future picker UI. */
export const LUCIDE_ICON_NAMES: string[] = Object.keys(ICONS).sort()

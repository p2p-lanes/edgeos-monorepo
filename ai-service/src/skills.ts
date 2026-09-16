import { readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export type EdgeOSSkill = {
  name: string
  description: string
  triggers: string[]
  operations: string[]
  instructions: string
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

function parseSkill(source: string): EdgeOSSkill | null {
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return null
  const metadata = Object.fromEntries(
    (match[1] ?? "")
      .split("\n")
      .map((line) => line.match(/^([a-z_]+):\s*(.*)$/i))
      .filter((item): item is RegExpMatchArray => item !== null)
      .map((item) => [item[1], item[2]]),
  )
  if (!metadata.name || !metadata.description) return null
  const list = (value?: string) =>
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  return {
    name: metadata.name,
    description: metadata.description,
    triggers: list(metadata.triggers),
    operations: list(metadata.operations),
    instructions: (match[2] ?? "").trim(),
  }
}

export class SkillRegistry {
  private skills: EdgeOSSkill[] = []

  async load() {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "skills")
    let directories: string[] = []
    try {
      directories = await readdir(root)
    } catch {
      console.warn(`EdgeOS skills directory is unavailable: ${root}`)
      return
    }
    const loaded = await Promise.all(
      directories.map(async (directory) => {
        try {
          return parseSkill(
            await readFile(join(root, directory, "SKILL.md"), "utf8"),
          )
        } catch {
          return null
        }
      }),
    )
    this.skills = loaded.filter((skill): skill is EdgeOSSkill => skill !== null)
  }

  search(query: string, limit = 4) {
    const normalized = normalize(query)
    const terms = normalized.split(/[^a-z0-9_:-]+/).filter(Boolean)
    return this.skills
      .map((skill) => {
        const haystack = normalize(
          [
            skill.name,
            skill.description,
            ...skill.triggers,
            ...skill.operations,
            skill.instructions,
          ].join(" "),
        )
        let score = haystack.includes(normalized) ? 20 : 0
        for (const term of terms) {
          if (haystack.includes(term)) score += term.length > 5 ? 3 : 1
        }
        return { skill, score }
      })
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map(({ skill }) => skill)
  }

  relevantInstructions(query: string) {
    const relevant = this.search(query)
    if (!relevant.length)
      return "No specialized workflow skill matched this request."
    return relevant
      .map(
        (skill) =>
          `## Skill: ${skill.name}\n${skill.description}\n\n${skill.instructions}`,
      )
      .join("\n\n")
  }
}

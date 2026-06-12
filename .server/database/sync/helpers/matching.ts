import { Case } from '@server/utils/common'

export function getStringSimilarity(str1: string, str2: string) {
  const getBigrams = (str: string) =>
    new Set(
      Array.from({ length: str.length - 1 }, (_, i) => str.slice(i, i + 2)),
    )
  const bg1 = getBigrams(str1.toLowerCase())
  const bg2 = getBigrams(str2.toLowerCase())
  const intersection = bg1.intersection(bg2).size
  const union = bg1.union(bg2).size
  return union === 0 ? (str1 === str2 ? 1 : 0) : intersection / union
}

export function findBestMatchAndPrompt(
  oldName: string,
  unmappedSet: Set<string>,
  itemType: 'table' | 'column',
  contextName: string,
  logger: any,
  threshold = 0.3,
): string | null {
  let bestAutoMatch: string | null = null
  let bestScore = 0

  for (const newCamel of unmappedSet) {
    const score = getStringSimilarity(oldName, Case.snake(newCamel))
    if (score > bestScore && score >= threshold) {
      bestScore = score
      bestAutoMatch = newCamel
    }
  }

  const unmappedArr = Array.from(unmappedSet)
  const options = [
    bestAutoMatch
      ? `Pick automatically (${Case.snake(bestAutoMatch)}: ${Math.round(bestScore * 100)}%)`
      : 'Pick automatically (none)',
    ...unmappedArr.map(t => `Use ${itemType}: ${Case.snake(t)}`),
    `Drop ${itemType}`,
  ]

  const promptMsg =
    itemType === 'table'
      ? `Unmapped database table: '${contextName}'. What should we do?`
      : `Unmapped column '${oldName}' in table '${contextName}'. What should we do?`
  const sel = logger.selectIndex(promptMsg, options)

  switch (true) {
    case sel === 0:
      return bestAutoMatch
    case sel === options.length - 1:
      return null
    default:
      return unmappedArr[sel - 1]
  }
}

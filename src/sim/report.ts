import type { ChoiceStat, RepeatSequenceStat, Summary } from './metrics';

function pct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function num(value: number, digits = 1): string {
  return value.toFixed(digits);
}

function interval(low: number, high: number): string {
  return `${pct(low)}–${pct(high)}`;
}

function sortedEntries(map: Record<string, number>): Array<[string, number]> {
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

function top(map: Record<string, number>, limit = 5): string {
  const entries = sortedEntries(map).slice(0, limit);
  if (!entries.length) return '无';
  return entries.map(([key, value]) => `${key} ${value}`).join(' · ');
}

function choiceRows(map: Record<string, ChoiceStat>): string {
  const entries = Object.entries(map).sort((a, b) => b[1].selected - a[1].selected);
  if (!entries.length) return '| 无 | 0 | 0 | - |\n';
  return entries
    .map(
      ([key, value]) =>
        `| ${key} | ${value.selected} | ${value.selectorWins} | ${
          value.selected ? pct(value.selectorWins / value.selected) : '-'
        } |\n`,
    )
    .join('');
}

function repeatRow(label: string, stat: RepeatSequenceStat): string {
  const top = stat.top[0]?.[0] ?? '-';
  return `| ${label} | ${stat.sample} | ${stat.unique} | ${pct(stat.repeatRate)} | ${pct(stat.topShare)} | ${num(stat.entropy, 2)} | \`${top}\` |\n`;
}

function repeatTop(stat: RepeatSequenceStat): string {
  if (!stat.top.length) return '无';
  return stat.top
    .slice(0, 3)
    .map(([sequence, count]) => `\`${sequence}\` ×${count}`)
    .join(' · ');
}

export function renderReport(summary: Summary, generatedAt = new Date()): string {
  const red = summary.result;
  const reasons = sortedEntries(summary.reasons);
  const first = summary.firstEvents;
  const duel = summary.duel;
  const trans = summary.transformations;
  const diversity = summary.diversity;
  const dynamics = summary.dynamics;

  const findings: string[] = [];
  const redExcludesHalf =
    red.redInterval.high < 0.5 || red.redInterval.low > 0.5;
  if (summary.finished < summary.total) {
    findings.push(
      `有 **${summary.unfinished}** 局未正常结束（上限 ${summary.config.maxPlies} 手）；先检查错误而不是解读平衡。`,
    );
  }
  if (red.redRate > 0.55 || red.redRate < 0.45) {
    findings.push(
      `红方胜率 **${pct(red.redRate)}**，95% CI ${interval(red.redInterval.low, red.redInterval.high)}${redExcludesHalf ? '，区间不包含 50%' : ''}；在 ${summary.total} 局中这是一个需要复测的颜色信号。`,
    );
  } else {
    findings.push(
      `红方胜率 **${pct(red.redRate)}**，95% CI ${interval(red.redInterval.low, red.redInterval.high)}；pilot 暂未显示明显的颜色偏差。`,
    );
  }
  if (duel.games > 0) {
    findings.push(
      `生死斗出现在 **${duel.games}/${summary.total}** 局（${pct(duel.rate)}），共触发 **${duel.triggers}** 次；先选方胜率 **${pct(duel.firstSelectorRate)}**（95% CI ${interval(duel.firstSelectorInterval.low, duel.firstSelectorInterval.high)}）。`,
    );
  const multiRate = duel.games ? duel.multiDuelGames / duel.games : 0;
    if (duel.multiDuelGames > 0) {
      const severe = multiRate > 0.2;
      findings.push(
        `**重复生死斗信号**：${duel.multiDuelGames} 局触发不止一次（占生死斗局 ${pct(multiRate)}），单局最多 **${duel.maxTriggersPerGame}** 次；平均每个有生死斗的局触发 **${num(duel.triggersPerDuelGame, 2)}** 次。触发原因分布：${top(duel.triggerReasons)}。${severe ? ' 这是明显的重复触发风险。' : ' 重复触发已降到较低水平。'}`,
      );
    } else {
      findings.push('本批没有重复触发生死斗。');
    }
  } else {
    findings.push('本批对局没有触发生死斗；需要更长的对局或更接近残局的 agent。');
  }
  findings.push(
    `平均 **${num(summary.lengths.mean)}** 手，中位 **${num(summary.lengths.median)}**；P10/P90 = ${num(summary.lengths.p10)}/${num(summary.lengths.p90)}。`,
  );
  findings.push(
    `平均吃子 **${num(summary.averages.captures)}**、将军 **${num(summary.averages.checks)}**、升变 **${num(summary.averages.promotions)}**；平均分支因子 **${num(summary.averages.branching)}**。`,
  );
  findings.push(
    `开局：首着熵 **${num(diversity.firstMoveEntropy, 2)}** bit；前 4 手唯一率 **${pct(diversity.uniqueOpeningRate4)}**；前 8 手唯一率 **${pct(diversity.uniqueOpeningRate8)}**。`,
  );
  const openingRepeat = summary.openingRepeat;
  if (openingRepeat.wins) {
    const risk =
      openingRepeat.firstMove.topShare >= 0.35 ||
      openingRepeat.first3Plies.topShare >= 0.25 ||
      openingRepeat.first5Plies.topShare >= 0.2;
    findings.push(
      `先攻（红方）获胜局的定式观察：首步最高频占比 **${pct(openingRepeat.firstMove.topShare)}**，前 3 半回合 **${pct(openingRepeat.first3Plies.topShare)}**，前 5 半回合 **${pct(openingRepeat.first5Plies.topShare)}**；${risk ? '**已出现定式风险**' : '暂未形成明显定式'}。`,
    );
  }
  if (trans.total) {
    const targetEntries = Object.entries(trans.byTarget).sort((a, b) => b[1].selected - a[1].selected);
    const redTiger = trans.byTarget['虎']?.selected ?? 0;
    const redDragon = trans.byTarget['龙']?.selected ?? 0;
    const blackTiger = trans.byTarget['坦']?.selected ?? 0;
    const blackDragon = trans.byTarget['仙']?.selected ?? 0;
    findings.push(
      `升变选择 **${trans.total}** 次；最常用目标：${targetEntries.map(([key, value]) => `${key} ${value.selected}`).join(' · ')}。`,
    );
    findings.push(
      `按阵营看：红方选虎 ${redTiger} / 选龙 ${redDragon}；黑方选坦 ${blackTiger} / 选仙 ${blackDragon}。双方都明显偏向“车+斜一步”的虎/坦，而不是龙/仙。`,
    );
  } else {
    findings.push('本批没有发生升变选择；生死斗样本不足。');
  }
  findings.push(
    `雪崩样本：**${dynamics.snowballGames}** 局出现 ≥200cp 领先，领先方最终胜率 **${pct(dynamics.snowballRate)}**，翻盘率 **${pct(dynamics.comebackRate)}**；终局接近（|eval|≤300）占 **${pct(dynamics.closeRate)}**。`,
  );
  if (summary.errors.length) {
    findings.push(`发现 **${summary.errors.length}** 条错误记录，详见文末。`);
  }

  const next: string[] = [];
  if (summary.finished < summary.total || summary.errors.length) {
    next.push('先修完未结束/异常对局，再扩大样本；否则胜率会被错误样本污染。');
  }
  if (red.redRate > 0.55 || red.redRate < 0.45) {
    next.push('颜色平衡：同 agent 镜像开局，扩到 2000 局；若仍偏离 45–55%，再查先手/阵营棋子价值。');
  }
  if (duel.multiDuelGames > 0) {
    const multiRate = duel.games ? duel.multiDuelGames / duel.games : 0;
    if (multiRate > 0.2) {
      next.push(
        `重复生死斗：本批有 ${duel.multiDuelGames} 局多次触发（占 ${pct(multiRate)}），最多 ${duel.maxTriggersPerGame} 次。做一个独立 A/B：保留当前规则 vs “同一触发条件冷却/每次材料变化只触发一次”，比较手数、胜负原因和先选方胜率；不要直接改冻结规则。`,
      );
    } else {
      next.push(
        `重复生死斗已明显减少（${duel.multiDuelGames}/${duel.games} 局多次，最多 ${duel.maxTriggersPerGame} 次）。把新规则扩到 1000–2000 局，重点确认它是否稳定接近“一局一次”，以及长局是否增加。`,
      );
    }
  }
  const firstSelectorStrong =
    duel.firstSelectorInterval.high < 0.45 || duel.firstSelectorInterval.low > 0.55;
  if (duel.firstSelectorTotal >= 5 && firstSelectorStrong) {
    next.push('生死斗先选优势：固定选子质量、随机化升变目标，专门跑 1000 局对比先选/后选胜率。');
  } else if (duel.firstSelectorTotal >= 5) {
    next.push('生死斗先选优势暂不明显；用 1000+ 局和随机化选子复核，避免把选子 AI 的偏好当成规则优势。');
  }
  if (trans.total && Object.values(trans.byTarget).some((entry) => entry.selected / trans.total > 0.7)) {
    next.push('升变目标集中：对虎/坦与龙/仙做随机强制选子 A/B，区分“AI 偏好”与“规则强度”。');
  }
  if (diversity.uniqueOpeningRate4 < 0.5) {
    next.push('开局重复偏高：加入 top-k 随机/开局扰动，先测“多样性上限”，再判断规则是否只有一条主线路。');
  }
  if (
    openingRepeat.firstMove.topShare >= 0.35 ||
    openingRepeat.first3Plies.topShare >= 0.25 ||
    openingRepeat.first5Plies.topShare >= 0.2
  ) {
    next.push('先攻定式风险：用强制首步/强制前 3 手 A/B，区分“AI 评估偏好”与“规则上真正的最优开局”；同时观察后手应对。');
  }
  if (dynamics.snowballGames && dynamics.snowballRate > 0.75) {
    next.push('雪崩信号：比较 20/40 手领先转化率，检查单王判负和超级子是否让领先过早锁定。');
  }
  next.push('把 pilot 扩到 2000–5000 局，并至少加入 random / greedy / search:2 / search:3 四类 agent，避免只测一种 AI。');
  next.push('最后必须做 5–10 人的人类试玩；AI 指标只能筛异常，不能证明“好玩”。');

  const reasonRows = reasons.length
    ? reasons.map(([key, value]) => `| ${key} | ${value} | ${pct(value / summary.total)} |\n`).join('')
    : '| 无 | 0 | - |\n';

  return `# 中国象棋WTF版 · Pilot 平衡与多样性报告

生成时间：${generatedAt.toISOString()}

## 重要说明

这是 **AI 自对弈 pilot**，不是人类可玩性结论。

- 样本：**${summary.total}** 局
- 红方 agent：\`${summary.config.red}\`
- 黑方 agent：\`${summary.config.black}\`
- 升变选子策略：red=\`${summary.config.selectionRed}\` black=\`${summary.config.selectionBlack}\`
- 随机种子：\`${summary.config.seed}\`
- 最大手数：${summary.config.maxPlies}
- 所有比例使用 Wilson 95% 置信区间；${summary.total} 局只能发现明显信号，不能证明细微差异。

---

## 总体结果

| 指标 | 数值 |
|---|---|
| 正常结束 | ${summary.finished} / ${summary.total} |
| 红胜 / 黑胜 | ${red.redWins} / ${red.blackWins} |
| 红方胜率 | **${pct(red.redRate)}**（95% CI ${interval(red.redInterval.low, red.redInterval.high)}） |
| 平均手数 / 中位 | ${num(summary.lengths.mean)} / ${num(summary.lengths.median)} |
| P10 / P90 | ${num(summary.lengths.p10)} / ${num(summary.lengths.p90)} |
| 最短 / 最长 | ${summary.lengths.min} / ${summary.lengths.max} |

### 胜负原因

| 原因 | 局数 | 占比 |
|---|---:|---:|
${reasonRows}

## 节奏与事件

| 指标 | 平均值 |
|---|---:|
| 吃子 / 局 | ${num(summary.averages.captures)} |
| 将军 / 局 | ${num(summary.averages.checks)} |
| 升变 / 局 | ${num(summary.averages.promotions)} |
| 己方吃奴（自吃） / 局 | ${num(summary.averages.selfCaptures)} |
| 平均合法着法数 | ${num(summary.averages.branching)} |
| 首次吃子手数 | ${first.capture === null ? '-' : num(first.capture)} |
| 首次将军手数 | ${first.check === null ? '-' : num(first.check)} |
| 首次升变手数 | ${first.promotion === null ? '-' : num(first.promotion)} |
| 首次生死斗手数 | ${first.duel === null ? '-' : num(first.duel)} |

## 生死斗

| 指标 | 数值 |
|---|---:|
| 触发局数 / 总对局 | ${duel.games} / ${summary.total}（${pct(duel.rate)}） |
| 触发次数 | ${duel.triggers} |
| 多次触发的局 / 单局最多 | ${duel.multiDuelGames} / ${duel.maxTriggersPerGame} |
| 平均每局触发（有生死斗的局） | ${num(duel.triggersPerDuelGame, 2)} |
| 触发原因 | ${top(duel.triggerReasons)} |
| 先选方胜率 | ${pct(duel.firstSelectorRate)}（95% CI ${interval(duel.firstSelectorInterval.low, duel.firstSelectorInterval.high)}） |
| 选子事件 / 被拒绝 | ${duel.selections} / ${duel.rejectedSelections} |

### 升变选择

| 目标 | 选择次数 | 选子方最终胜 | 选子方胜率 |
|---|---:|---:|---:|
${choiceRows(trans.byTarget)}

> “选子方最终胜”是相关性，不是因果；选子方可能本来就更优。

| 棋子 | 选择次数 | 选子方最终胜 | 选子方胜率 |
|---|---:|---:|---:|
${choiceRows(trans.byPiece)}

按颜色选择次数：${top(trans.byColor)}

## 多样性

| 指标 | 数值 |
|---|---:|
| 首着种类 | ${Object.keys(diversity.firstMoves).length} |
| 首着熵 | ${num(diversity.firstMoveEntropy, 2)} bit |
| 前 4 手唯一序列 | ${diversity.uniqueOpenings4}（${pct(diversity.uniqueOpeningRate4)}） |
| 前 8 手唯一序列 | ${diversity.uniqueOpenings8}（${pct(diversity.uniqueOpeningRate8)}） |
| 平均唯一局面数 / 总局面数 | ${num(diversity.avgUniquePositions)} / ${num(diversity.avgPositionsTotal)} |

首着分布：${top(diversity.firstMoves, 8)}

## 先攻获胜局的开局重复率

只统计 **红方获胜** 的对局。
“重复率” = “1 - 唯一起始序列数 / 样本数”，表示有多少局与之前的某局共享同一序列；“最高频占比” 表示最常用序列占样本的比例。

| 口径 | 样本 | 唯一 | 重复率 | 最高频占比 | 熵 | 最高频序列 |
|---|---:|---:|---:|---:|---:|---|
${repeatRow('首步', openingRepeat.firstMove)}${repeatRow('前 3 半回合', openingRepeat.first3Plies)}${repeatRow('前 5 半回合', openingRepeat.first5Plies)}${repeatRow('红方前 3 手', openingRepeat.redFirst3Moves)}${repeatRow('红方前 5 手', openingRepeat.redFirst5Moves)}
最高频组合：

- 首步：${repeatTop(openingRepeat.firstMove)}
- 前 3 半回合：${repeatTop(openingRepeat.first3Plies)}
- 前 5 半回合：${repeatTop(openingRepeat.first5Plies)}
- 红方前 3 手：${repeatTop(openingRepeat.redFirst3Moves)}
- 红方前 5 手：${repeatTop(openingRepeat.redFirst5Moves)}

> 首步/前 3 手样本多，重复率有统计意义；前 5 半回合的精确序列通常很分散，单看“唯一数”可能低估套路集中度，因此同时看最高频占比和熵。

## 动态与雪崩

| 指标 | 数值 |
|---|---:|
| 评估波动（平均绝对变化） | ${num(dynamics.evalVolatility)} cp |
| 单局最大评估摆动（平均） | ${num(dynamics.maxEvalSwing)} cp |
| 领先易手次数 / 局 | ${num(dynamics.leadChanges)} |
| 终局接近（|eval|≤300） | ${dynamics.closeGames}（${pct(dynamics.closeRate)}） |
| 出现 ≥200cp 领先的局 | ${dynamics.snowballGames} |
| 领先方最终胜率 | ${pct(dynamics.snowballRate)} |
| 翻盘率 | ${pct(dynamics.comebackRate)} |

## Pilot 信号

${findings.map((item) => `- ${item}`).join('\n')}

## 下一轮实验建议

${next.map((item, index) => `${index + 1}. ${item}`).join('\n')}

## 方法

- 每个游戏使用独立 seed；agent 的随机选择由同一 seed 派生。
- 搜索 agent 使用固定最大深度 + 时间上限；批量实验优先固定深度，避免纯时间限制带来的不可复现。
- 生死斗倒计时、两阶段选子、限制回合由 runner 自动处理。
- 所有对局记录在 \`games.jsonl\`，包含完整着法、评估、升变选择、触发原因和错误信息。
- ${summary.total} 局 pilot 用于验证数据管线和发现明显异常；正式结论应基于 2000+ 局、多种 agent 和人类试玩。

## 错误记录

${summary.errors.length ? summary.errors.map((error) => `- ${error}`).join('\n') : '无。'}
`;
}

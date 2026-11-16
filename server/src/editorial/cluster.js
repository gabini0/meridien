// Regroupement des articles traitant d'un même événement, et calcul du niveau d'importance.
// Le recoupement compte les GROUPES éditoriaux distincts, pas le nombre d'articles.
const STOP = new Set(('the a an and or of to in on for with from by at as is are was were be been has have had will would after before over into amid says say said new more than its his her their this that who what how why not but out up about against ' +
  'le la les un une des du de et ou au aux en dans sur pour avec par ce cette ces son sa ses leur leurs qui que quoi est sont été être a ont après avant plus moins pas ne se sa selon face entre vers chez dont mais comme').split(' '));

export function tokens(title) {
  const s = title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return [...new Set(s.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.has(w)))];
}

export function similar(aTokens, bTokens, aTerr, bTerr) {
  const b = new Set(bTokens);
  const shared = aTokens.filter((t) => b.has(t)).length;
  if (shared < 3) return false;
  const ratio = shared / Math.min(aTokens.length, bTokens.length);
  const terrOk = !aTerr.length || !bTerr.length || aTerr.some((t) => bTerr.includes(t));
  return terrOk && ratio >= 0.6;
}

const WEIGHT = { conflict: 15, diplomacy: 15, security: 15, politics: 10, economy: 10, health: 10, environment: 10 };

/**
 * Niveau d'importance internationale. Critères explicites (aucune mesure d'audience ou de popularité) :
 * étendue du recoupement, nombre de pays concernés, couverture dans plusieurs langues, thématique.
 */
export function importance({ sourceGroups, countries, langs, category }) {
  const parts = [];
  const g = sourceGroups >= 4 ? 55 : sourceGroups === 3 ? 40 : sourceGroups === 2 ? 25 : 0;
  parts.push({ k: 'sources', n: sourceGroups, pts: g });
  const c = countries >= 3 ? 20 : countries === 2 ? 15 : 0;
  parts.push({ k: 'countries', n: countries, pts: c });
  const l = langs >= 2 ? 10 : 0;
  parts.push({ k: 'languages', n: langs, pts: l });
  const w = WEIGHT[category] ?? 0;
  parts.push({ k: 'category', n: category, pts: w });
  const score = g + c + l + w;
  return { score, level: levelOf(score), parts };
}
export const levelOf = (score) => (score >= 70 ? 'major' : score >= 40 ? 'important' : 'notable');

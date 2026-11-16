// Classement thématique et nature de l'information — règles lexicales transparentes (FR/EN).
// Il s'agit d'un pré-classement automatique, corrigeable par la rédaction.
export const CATEGORIES = ['politics', 'diplomacy', 'economy', 'security', 'conflict', 'society', 'environment', 'science', 'culture', 'health', 'other'];

const LEX = {
  conflict: /\b(war|guerre|strike|strikes|frappe|frappes|airstrike|bombard\w*|offensive|ceasefire|cessez-le-feu|invasion|shelling|missile|missiles|drone|drones|frontline|front|troops|troupes|rebels?|rebelles?|militia|milice|hostages?|otages?|killed|tués?|clashes|affrontements|insurg\w+|truce|trêve|combats?|fighting)\b/giu,
  security: /\b(army|armée|military|militaire|défense|defen[cs]e|nato|otan|terror\w*|attentat|attack|attaque|police|security|sécurité|espionage|espionnage|cyberatta\w+|nuclear|nucléaire|weapons?|armes?|navy|marine|intelligence|renseignement)\b/giu,
  diplomacy: /\b(diploma\w+|ambassad\w+|summit|sommet|treaty|traité|talks|pourparlers|négociations?|negotiations?|sanctions?|united nations|nations unies|onu|envoy|émissaire|foreign minister|ministre des affaires étrangères|accord|agreement|bilateral|bilatéral\w*|g7|g20|brics|visit|visite|state visit|security council|conseil de sécurité)\b/giu,
  politics: /\b(election\w*|élection\w*|vote|scrutin|parliament|parlement|president\w*|président\w*|prime minister|premier ministre|government|gouvernement|coalition|opposition|referendum|référendum|coup|putsch|minister|ministre|senate|sénat|congress|congrès|campaign|campagne|party|parti|impeach\w+|destitution|constitution\w*|protest\w*|manifestation\w*)\b/giu,
  economy: /\b(econom\w+|économ\w+|inflation|gdp|pib|trade|commerce|tariffs?|droits de douane|market|marchés?|bank|banque|central bank|banque centrale|budget|debt|dette|oil|pétrole|gas|gaz|exports?|exportations?|imports?|importations?|recession|récession|currency|monnaie|unemployment|chômage|investment|investissements?|growth|croissance|imf|fmi|stocks?|bourse)\b/giu,
  society: /\b(migra\w+|refugees?|réfugiés?|rights|droits|education|éducation|women|femmes|strike action|grève|court|tribunal|justice|trial|procès|crime|prison|religio\w+|church|église|inequalit\w+|inégalités?|housing|logement|verdict|sentence[d]?|condamn\w+)\b/giu,
  environment: /\b(climate|climat\w*|cop\d+|emissions?|émissions?|flood\w*|inondations?|drought|sécheresse|wildfires?|incendies?|earthquake|séisme|hurricane|ouragan|cyclone|typhoon|typhon|biodiversit\w+|pollution|deforestation|déforestation|heatwave|canicule|volcan\w*|tsunami|storm|tempête|global warming|réchauffement)\b/giu,
  science: /\b(scien\w+|research\w*|recherche|space|spatial\w*|nasa|esa|satellite|artificial intelligence|intelligence artificielle|\bai\b|\bia\b|technolog\w+|chip|semiconductors?|semi-conducteurs?|quantum|quantique|rocket|fusée|study finds|étude|cyber\w*|robot\w*)\b/giu,
  culture: /\b(film|cinema|cinéma|festival|museum|musée|music|musique|art|artist\w*|book|livre|literature|littérature|heritage|patrimoine|unesco|oscar|nobel|exhibition|exposition|theatre|théâtre|olympi\w+|world cup|coupe du monde)\b/giu,
  health: /\b(health|santé|hospital\w*|hôpita\w+|virus|epidemi\w+|épidémi\w+|pandemi\w+|pandémi\w+|vaccin\w*|who|oms|disease|maladie|outbreak|cholera|choléra|ebola|covid\w*|malaria|paludisme|cancer|famine|malnutrition|doctors?|médecins?|mpox)\b/giu,
};

export function classifyCategory(textIn) {
  const text = textIn ?? '';
  let best = 'other', bestN = 0;
  for (const [cat, re] of Object.entries(LEX)) {
    const n = (text.match(re) ?? []).length;
    if (n > bestN) { best = cat; bestN = n; }
  }
  return best;
}

const STATEMENT = /\b(says?|said|claims?|claimed|accuses?|denies|denied|warns?|vows?|pledges?|according to|alleges?|urges?|calls for|selon|affirme\w*|déclare\w*|accuse\w*|dément\w*|assure\w*|annonce\w*|promet\w*|d'après|estime\w*|dénonce\w*|appelle\w*)\b|[«"“][^»"”]{8,}[»"”]/iu;
const ANALYSIS = /\b(opinion|analysis|analyse|comment(ary)?|editorial|éditorial|tribune|chronique|décryptage|explainer|idées|point de vue|the big idea|long read)\b/iu;

/** report : fait rapporté par la source · statement : déclaration rapportée · analysis : analyse ou opinion */
export function classifyClaim({ title, url, feedCategories = [] }) {
  if (ANALYSIS.test(feedCategories.join(' ')) || /\/(opinion|commentisfree|idees|analysis|tribune|debats|comment)\//i.test(url ?? '')) return 'analysis';
  if (STATEMENT.test(title ?? '')) return 'statement';
  return 'report';
}

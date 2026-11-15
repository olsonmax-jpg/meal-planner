// Aisle auto-sort: simple keyword list (English + Dutch), no AI needed.
export const AISLES = [
  'Vegetables & fruit',
  'Meat & fish',
  'Dairy & eggs',
  'Bakery',
  'Spices & herbs',
  'Pantry',
  'Frozen',
  'Drinks',
  'Other',
]

const RULES = {
  'Meat & fish': 'chicken kip thigh thighs breast beef rund mince gehakt pork varken bacon spek sausage worst salmon zalm fish vis tuna tonijn shrimp prawn garnaal lamb lam ham steak chorizo turkey kalkoen',
  'Dairy & eggs': 'milk melk cheese kaas butter boter cream room yoghurt yogurt egg eggs ei eieren feta mozzarella parmesan parmigiano ricotta mascarpone creme kwark',
  'Spices & herbs': 'salt zout pepper peper paprika cumin komijn cinnamon kaneel oregano thyme tijm rosemary rozemarijn basil basilicum parsley peterselie coriander koriander cilantro chilli chili flakes harissa turmeric kurkuma garam masala curry spice kruiden bay laurier nutmeg nootmuskaat dill dille mint munt sage salie',
  'Vegetables & fruit': 'onion ui uien garlic knoflook potato potatoes aardappel aardappelen tomato tomatoes tomaat tomaten carrot carrots wortel wortelen lettuce sla spinach spinazie cucumber komkommer courgette aubergine broccoli cauliflower bloemkool mushroom mushrooms champignon avocado lemon citroen lime apple appel banana banaan berries bessen ginger gember leek prei cabbage kool kale celery selderij bosui zucchini pumpkin pompoen beet bieten corn mais peas erwten fruit orange sinaasappel grape druif mango',
  'Bakery': 'bread brood bun buns broodje tortilla tortillas wrap wraps pita naan baguette roll toast croissant dough deeg flour bloem yeast gist',
  'Frozen': 'frozen diepvries ice ijs',
  'Drinks': 'wine wijn beer bier juice sap water cola soda koffie coffee tea thee',
  'Pantry': 'pasta rice rijst noodle noodles noedels oil olie vinegar azijn sugar suiker honey honing stock bouillon chickpea chickpeas kikkererwten lentil lentils linzen sauce saus soy sojasaus coconut kokos nuts noten almond amandel oats haver spaghetti penne passata puree paste mustard mosterd mayo ketchup mais baking cocoa cacao chocolate chocolade',
}

// Check specific aisles before generic ones (e.g. "pepper flakes" is a spice).
const ORDER = ['Frozen', 'Meat & fish', 'Dairy & eggs', 'Bakery', 'Drinks', 'Spices & herbs', 'Pantry', 'Vegetables & fruit']

export function guessAisle(name) {
  const text = ' ' + String(name || '').toLowerCase().replace(/[^a-zÀ-ÿ\s]/g, ' ') + ' '
  if (/\b(tinned|canned|blik|passata|tomato paste|tomatenpuree|coconut milk|kokosmelk|chickpeas?|stock|bouillon)\b/.test(text)) return 'Pantry'
  for (const aisle of ORDER) {
    if (RULES[aisle].split(' ').some(w => text.includes(' ' + w + ' ') || text.includes(' ' + w + 's ') || text.includes(' ' + w + 'es '))) return aisle
  }
  return 'Other'
}

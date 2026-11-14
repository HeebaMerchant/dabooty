(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DishCheck = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const FILLERS = new Set([
    "a", "an", "the", "my", "our", "famous", "homemade", "home", "made",
    "special", "classic", "best", "extra", "super", "really", "very",
    "moms", "mom", "grandmas", "grandma", "nanas", "nana", "aunties",
    "auntie", "uncles", "uncle", "style", "recipe", "ultimate", "original", "og"
  ]);

  const VAGUE = new Set([
    "pie", "pies", "salad", "bread", "meat", "dessert", "desserts", "drink",
    "drinks", "wine", "soda", "juice", "snack", "snacks", "appetizer", "apps",
    "side", "sides", "main", "mains", "food", "stuff", "thing", "things",
    "dish", "casserole", "soup", "pasta", "chicken", "beef", "pork", "veggies",
    "vegetables", "vegetable", "fruit", "cheese", "potatoes", "potato", "beans",
    "bean", "rice", "cake", "cider", "beer", "booze", "alcohol", "coffee", "tea"
  ]);

  const IRREGULAR = {
    fries: "fry",
    cranberries: "cranberry",
    berries: "berry",
    cookies: "cookie",
    leaves: "leaf"
  };

  function stemWord(word) {
    if (IRREGULAR[word]) return IRREGULAR[word];
    if (word.length > 5 && word.endsWith("oes")) return word.slice(0, -2);
    if (word.length > 6 && word.endsWith("ies")) return word.slice(0, -3) + "y";
    if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
    return word;
  }

  function normalizeDish(raw) {
    const words = String(raw || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word && !FILLERS.has(word))
      .map(stemWord);
    return words.join(" ").trim();
  }

  const HEADS = [
    {
      id: "turkey",
      test: (name) => /\bturkey\b/.test(name) && !/\b(gravy|soup|chili|sandwich|salad|broth|stock|noodle|bacon|meatball|slider)\b/.test(name)
    },
    {
      id: "ham",
      test: (name) => /\bham\b/.test(name) && !/\b(sandwich|slider|biscuit|burger)\b/.test(name)
    },
    {
      id: "mac",
      test: (name) =>
        (/\bmac\b/.test(name) && /\bcheese\b/.test(name)) ||
        (/\bmacaroni\b/.test(name) && /\bcheese\b/.test(name))
    },
    {
      id: "mash",
      test: (name) => /\bmash(ed)? potato\b/.test(name) || /\bwhipped potato\b/.test(name)
    },
    {
      id: "gbc",
      test: (name) => /\bgreen bean\b/.test(name) && /\bcasserole\b/.test(name)
    },
    {
      id: "greens",
      test: (name) => /\bgreen bean\b/.test(name) && !/\b(casserole|salad)\b/.test(name)
    },
    {
      id: "sweetpie",
      test: (name) => /\bsweet potato pie\b/.test(name)
    },
    {
      id: "yam",
      test: (name) =>
        (/\bsweet potato\b/.test(name) || /\byams?\b/.test(name)) &&
        !/\b(pie|fries|fry|chip|chips|soup|bread|waffle)\b/.test(name)
    },
    {
      id: "pumpkinpie",
      test: (name) => /\bpumpkin pie\b/.test(name)
    },
    {
      id: "applepie",
      test: (name) => /\bapple pie\b/.test(name)
    },
    {
      id: "pecanpie",
      test: (name) => /\bpecan pie\b/.test(name)
    },
    {
      id: "stuffing",
      test: (name) => /\b(stuffing|dressing)\b/.test(name) && !/\bsalad\b/.test(name)
    },
    {
      id: "cornbread",
      test: (name) => /\b(cornbread|corn bread)\b/.test(name) && !/\b(stuffing|dressing)\b/.test(name)
    },
    {
      id: "cran",
      test: (name) => /\bcranberry\b/.test(name) && !/\b(stuffing|dressing|salad)\b/.test(name)
    },
    {
      id: "gravy",
      test: (name) => /\bgravy\b/.test(name)
    },
    {
      id: "rolls",
      test: (name) => /\brolls?\b/.test(name) && !/\b(spring|egg|cinnamon|jelly|sausage)\b/.test(name)
    },
    {
      id: "biscuits",
      test: (name) => /\bbiscuit\b/.test(name) && !/\bgravy\b/.test(name)
    },
    {
      id: "deviled",
      test: (name) => /\bdeviled eggs?\b/.test(name)
    },
    {
      id: "collards",
      test: (name) => /\bcollard\b/.test(name)
    },
    {
      id: "potato salad",
      test: (name) => /\bpotato salad\b/.test(name)
    },
    {
      id: "garden salad",
      test: (name) => /\b(garden|green|house|side) salad\b/.test(name)
    },
    {
      id: "sprouts",
      test: (name) => /\bbrussel\b/.test(name) || /\bbrussels\b/.test(name)
    },
    {
      id: "chicken",
      test: (name) => /\bchicken\b/.test(name) && !/\b(wing|soup|salad|stock|broth|noodle|dip)\b/.test(name)
    }
  ];

  function headOf(name) {
    const hit = HEADS.find((head) => head.test(name));
    return hit ? hit.id : null;
  }

  function levenshtein(a, b) {
    const rows = a.length + 1;
    const cols = b.length + 1;
    const grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
    for (let i = 0; i < rows; i += 1) grid[i][0] = i;
    for (let j = 0; j < cols; j += 1) grid[0][j] = j;
    for (let i = 1; i < rows; i += 1) {
      for (let j = 1; j < cols; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        grid[i][j] = Math.min(grid[i - 1][j] + 1, grid[i][j - 1] + 1, grid[i - 1][j - 1] + cost);
      }
    }
    return grid[a.length][b.length];
  }

  function ratio(a, b) {
    const max = Math.max(a.length, b.length);
    if (!max) return 1;
    return 1 - levenshtein(a, b) / max;
  }

  function isDuplicatePair(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    const ha = headOf(a);
    const hb = headOf(b);
    if (ha && hb) return ha === hb;
    const minLen = Math.min(a.length, b.length);
    const score = ratio(a, b);
    if (minLen >= 6 && levenshtein(a, b) <= 1) return true;
    if (ha || hb) return minLen >= 8 && score >= 0.86;
    return minLen >= 8 && score >= 0.92;
  }

  function inspect(dishes, raw) {
    const name = normalizeDish(raw);
    const shown = String(raw || "").trim();
    if (name.length < 2) return { status: "empty", name, shown };
    const conflict = (dishes || []).find((dish) => isDuplicatePair(name, normalizeDish(dish.dish)));
    if (conflict) return { status: "duplicate", name, shown, conflict };
    const soft = (dishes || []).find((dish) => {
      if (name.length < 3 || name.length > 18) return false;
      return normalizeDish(dish.dish).split(" ").includes(name);
    });
    if (soft) return { status: "similar", name, shown, conflict: soft };
    if (VAGUE.has(name)) return { status: "vague", name, shown };
    return { status: "clear", name, shown };
  }

  const SUGGESTIONS = [
    { dish: "Roast turkey", category: "main" },
    { dish: "Honey ham", category: "main" },
    { dish: "Mac & cheese", category: "side" },
    { dish: "Mashed potatoes", category: "side" },
    { dish: "Green bean casserole", category: "side" },
    { dish: "Sweet potato casserole", category: "side" },
    { dish: "Stuffing", category: "side" },
    { dish: "Cranberry sauce", category: "side" },
    { dish: "Collard greens", category: "side" },
    { dish: "Dinner rolls", category: "side" },
    { dish: "Cornbread", category: "side" },
    { dish: "Brussels sprouts", category: "side" },
    { dish: "Garden salad", category: "side" },
    { dish: "Pumpkin pie", category: "dessert" },
    { dish: "Apple pie", category: "dessert" },
    { dish: "Pecan pie", category: "dessert" },
    { dish: "Sparkling cider", category: "drink" },
    { dish: "Deviled eggs", category: "other" },
    { dish: "Gravy", category: "other" }
  ];

  return { normalizeDish, inspect, isDuplicatePair, headOf, SUGGESTIONS };
});
